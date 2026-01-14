import type { GraphQLContext } from '@solufacil/graphql-schema'
import { UserRole } from '@solufacil/database'
import { toDecimal, MONTH_NAMES } from '@solufacil/shared'
import { authenticateUser, requireRole } from '../middleware/auth'
import { LocationHistoryService } from '../services/LocationHistoryService'

interface DeadDebtFilters {
  weeksSinceLoanMin?: number | null
  weeksWithoutPaymentMin?: number | null
  routeId?: string | null
  localities?: string[] | null
  badDebtStatus?: 'ALL' | 'MARKED' | 'UNMARKED' | null
  fromDate?: Date | null
  toDate?: Date | null
}

// Shared include for loan queries with relations
const LOAN_INCLUDE_WITH_RELATIONS = {
  borrowerRelation: {
    include: {
      personalDataRelation: true
    }
  },
  leadRelation: {
    include: {
      personalDataRelation: {
        include: {
          addresses: {
            include: {
              locationRelation: true
            }
          }
        }
      },
      routes: true
    }
  },
  payments: {
    orderBy: { receivedAt: 'desc' as const },
    take: 10
  }
}

/**
 * Build base filters for loans query
 * Note: Route filtering is done after the query using historical route lookup
 * to be consistent with portfolioReportMonthly
 */
function buildLoanFilters(filters: DeadDebtFilters, now: Date) {
  const {
    weeksSinceLoanMin,
    weeksWithoutPaymentMin,
    // routeId is NOT used here - filtering by route is done after query
    // using LocationHistoryService for consistency with portfolioReportMonthly
    badDebtStatus,
    fromDate,
    toDate
  } = filters

  const andFilters: any[] = [
    { finishedDate: null },
    { pendingAmountStored: { gt: 0 } }
  ]

  // Route filter removed - now done via LocationHistoryService after query

  if (badDebtStatus === 'MARKED') {
    const badDebtDateFilter: any = { not: null }
    if (fromDate || toDate) {
      const dateRange: any = {}
      if (fromDate) dateRange.gte = new Date(fromDate)
      if (toDate) dateRange.lte = new Date(toDate)
      Object.assign(badDebtDateFilter, dateRange)
    }
    andFilters.push({ badDebtDate: badDebtDateFilter })
  } else if (badDebtStatus === 'UNMARKED' || !badDebtStatus) {
    andFilters.push({ badDebtDate: null })
  }

  if (weeksSinceLoanMin != null) {
    const minDate = new Date(now.getTime() - (weeksSinceLoanMin * 7 * 24 * 60 * 60 * 1000))
    andFilters.push({ signDate: { lte: minDate } })
  }

  if (weeksWithoutPaymentMin != null) {
    const minDate = new Date(now.getTime() - (weeksWithoutPaymentMin * 7 * 24 * 60 * 60 * 1000))
    andFilters.push({
      OR: [
        { payments: { none: { receivedAt: { gte: minDate } } } },
        { payments: { none: {} } }
      ]
    })
  }

  return { AND: andFilters }
}

/**
 * Calculate bad debt candidate amount for a loan
 * Formula: pendingAmount - uncollectedProfit
 */
function calculateBadDebtCandidate(loan: any): number {
  const amountGived = toDecimal(loan.amountGived)
  const profitAmount = toDecimal(loan.profitAmount)
  const totalToPay = amountGived + profitAmount
  const pendingAmount = toDecimal(loan.pendingAmountStored)

  const uncollectedProfit = totalToPay > 0 ? pendingAmount * (profitAmount / totalToPay) : 0
  return Math.max(0, pendingAmount - uncollectedProfit)
}

/**
 * Process a loan and return formatted dead debt data
 */
function processLoan(loan: any, evaluationDate: Date) {
  const signDate = new Date(loan.signDate)
  const weeksSinceLoan = Math.floor((evaluationDate.getTime() - signDate.getTime()) / (7 * 24 * 60 * 60 * 1000))

  let weeksWithoutPayment = weeksSinceLoan
  if (loan.payments && loan.payments.length > 0) {
    const lastPayment = loan.payments[0]
    if (lastPayment.receivedAt) {
      const lastPaymentDate = new Date(lastPayment.receivedAt)
      weeksWithoutPayment = Math.floor((evaluationDate.getTime() - lastPaymentDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
    }
  }

  const pendingAmount = toDecimal(loan.pendingAmountStored)
  const badDebtCandidate = calculateBadDebtCandidate(loan)

  const leadPersonalData = loan.leadRelation?.personalDataRelation
  const leadLocality = leadPersonalData?.addresses?.[0]?.locationRelation?.name || 'No locality'
  const leadRoute = loan.leadRelation?.routes?.[0]?.name || 'No route'

  return {
    id: loan.id,
    amountGived: toDecimal(loan.amountGived).toString(),
    signDate: loan.signDate.toISOString(),
    pendingAmountStored: pendingAmount.toString(),
    badDebtDate: loan.badDebtDate?.toISOString() || null,
    badDebtCandidate: badDebtCandidate.toString(),
    weeksSinceLoan,
    weeksWithoutPayment,
    borrower: {
      fullName: loan.borrowerRelation?.personalDataRelation?.fullName || 'No name',
      clientCode: loan.borrowerRelation?.personalDataRelation?.clientCode || 'No code'
    },
    lead: {
      fullName: leadPersonalData?.fullName || 'No leader',
      locality: leadLocality,
      route: leadRoute
    },
    payments: (loan.payments || []).slice(0, 5).map((p: any) => ({
      receivedAt: p.receivedAt?.toISOString() || null,
      amount: toDecimal(p.amount).toString()
    }))
  }
}

/**
 * Filter loans by localities (in-memory filter)
 */
function filterByLocalities(loans: any[], localities: string[] | null | undefined) {
  if (!localities || localities.length === 0) return loans

  const allowedLocalities = new Set(localities.filter(Boolean))
  return loans.filter(loan => {
    const leadLocality = loan.leadRelation?.personalDataRelation?.addresses?.[0]?.locationRelation?.name || ''
    return allowedLocalities.has(leadLocality)
  })
}

/**
 * Helper to extract locationId from a loan entity
 */
const getLoanLocationId = (loan: any): string | null | undefined =>
  loan.leadRelation?.personalDataRelation?.addresses?.[0]?.location

export const deadDebtResolvers = {
  Query: {
    deadDebtLoans: async (
      _parent: unknown,
      args: {
        weeksSinceLoanMin?: number | null
        weeksWithoutPaymentMin?: number | null
        routeId?: string | null
        localities?: string[] | null
        badDebtStatus?: 'ALL' | 'MARKED' | 'UNMARKED' | null
        fromDate?: string | null
        toDate?: string | null
        evaluationDate?: string | null
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, [UserRole.ADMIN])

      // Use evaluationDate if provided, otherwise use current date
      const evaluationDate = args.evaluationDate ? new Date(args.evaluationDate) : new Date()
      const filters: DeadDebtFilters = {
        ...args,
        fromDate: args.fromDate ? new Date(args.fromDate) : null,
        toDate: args.toDate ? new Date(args.toDate) : null
      }

      const whereClause = buildLoanFilters(filters, evaluationDate)

      let loans = await context.prisma.loan.findMany({
        where: whereClause,
        include: LOAN_INCLUDE_WITH_RELATIONS,
        orderBy: { signDate: 'asc' }
      })

      // Filter by route using historical route lookup (consistent with portfolioReportMonthly)
      // Uses evaluationDate as reference for historical route lookup
      if (args.routeId) {
        const locationHistoryService = new LocationHistoryService(context.prisma)
        loans = await locationHistoryService.filterEntitiesByHistoricalRoute(
          loans, args.routeId, evaluationDate, getLoanLocationId
        )
      }

      loans = filterByLocalities(loans, args.localities)

      const processedLoans = loans.map(loan => processLoan(loan, evaluationDate))

      const totalPendingAmount = processedLoans.reduce((sum, loan) => sum + parseFloat(loan.pendingAmountStored), 0)
      const totalBadDebtCandidate = processedLoans.reduce((sum, loan) => sum + parseFloat(loan.badDebtCandidate), 0)
      const localities = [...new Set(processedLoans.map(loan => loan.lead.locality))]

      return {
        loans: processedLoans,
        summary: {
          totalLoans: processedLoans.length,
          totalPendingAmount: totalPendingAmount.toString(),
          totalBadDebtCandidate: totalBadDebtCandidate.toString()
        },
        localities
      }
    },

    deadDebtMonthlySummary: async (
      _parent: unknown,
      args: {
        year: number
        routeId?: string | null
        localities?: string[] | null
        weeksSinceLoanMin?: number | null
        weeksWithoutPaymentMin?: number | null
        badDebtStatus?: 'ALL' | 'MARKED' | 'UNMARKED' | null
        fromDate?: string | null
        toDate?: string | null
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, [UserRole.ADMIN])

      const { year, routeId, localities, badDebtStatus } = args

      const andFilters: any[] = [
        { finishedDate: null },
        { pendingAmountStored: { gt: 0 } }
      ]

      // Route filter removed - now done via LocationHistoryService after query

      if (badDebtStatus === 'MARKED') {
        andFilters.push({ badDebtDate: { not: null } })
      } else if (badDebtStatus === 'UNMARKED' || !badDebtStatus) {
        andFilters.push({ badDebtDate: null })
      }

      let allLoans = await context.prisma.loan.findMany({
        where: { AND: andFilters },
        include: LOAN_INCLUDE_WITH_RELATIONS
      })

      // Filter by route using historical route lookup (consistent with portfolioReportMonthly)
      if (routeId) {
        const locationHistoryService = new LocationHistoryService(context.prisma)
        allLoans = await locationHistoryService.filterEntitiesByHistoricalRoute(
          allLoans, routeId, new Date(), getLoanLocationId
        )
      }

      allLoans = filterByLocalities(allLoans, localities)

      const monthlySummary = []
      const processedLoanIds = new Set<string>()

      const fromDateFilter = args.fromDate ? new Date(args.fromDate) : null
      const toDateFilter = args.toDate ? new Date(args.toDate) : null

      for (let month = 1; month <= 12; month++) {
        const monthStart = new Date(year, month - 1, 1)
        const monthEnd = new Date(year, month, 0, 23, 59, 59, 999)

        if (fromDateFilter && monthEnd < fromDateFilter) continue
        if (toDateFilter && monthStart > toDateFilter) continue

        const evaluationDate = monthEnd

        const loansInMonth = allLoans.filter(loan => {
          if (processedLoanIds.has(loan.id)) return false

          const signDate = new Date(loan.signDate)
          if (signDate > monthEnd) return false

          const weeksSinceLoan = Math.floor((evaluationDate.getTime() - signDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
          if (args.weeksSinceLoanMin != null && weeksSinceLoan < args.weeksSinceLoanMin) return false

          let weeksWithoutPayment = weeksSinceLoan
          if (loan.payments && loan.payments.length > 0) {
            const lastPaymentDate = loan.payments[0].receivedAt
            if (lastPaymentDate) {
              weeksWithoutPayment = Math.floor((evaluationDate.getTime() - lastPaymentDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
            }
          }
          if (args.weeksWithoutPaymentMin != null && weeksWithoutPayment < args.weeksWithoutPaymentMin) return false

          return true
        })

        loansInMonth.forEach(loan => processedLoanIds.add(loan.id))

        const processedLoans = loansInMonth.map(loan => processLoan(loan, evaluationDate))

        const totalPendingAmount = processedLoans.reduce((sum, loan) => sum + parseFloat(loan.pendingAmountStored), 0)
        const totalBadDebtCandidate = processedLoans.reduce((sum, loan) => sum + parseFloat(loan.badDebtCandidate), 0)

        monthlySummary.push({
          month: {
            year,
            month,
            name: MONTH_NAMES[month - 1],
            startDate: monthStart.toISOString(),
            endDate: monthEnd.toISOString()
          },
          evaluationPeriod: {
            from: monthStart.toISOString(),
            to: monthEnd.toISOString(),
            description: `From ${monthStart.toLocaleDateString('en-US')} to ${monthEnd.toLocaleDateString('en-US')}`
          },
          criteria: {
            weeksSinceLoanMin: args.weeksSinceLoanMin,
            weeksWithoutPaymentMin: args.weeksWithoutPaymentMin,
            badDebtStatus: args.badDebtStatus || 'UNMARKED',
            localities: localities || []
          },
          summary: {
            totalLoans: processedLoans.length,
            totalPendingAmount: totalPendingAmount.toString(),
            totalBadDebtCandidate: totalBadDebtCandidate.toString()
          },
          loans: processedLoans
        })
      }

      const yearTotals = monthlySummary.reduce(
        (acc, month) => ({
          totalLoans: acc.totalLoans + month.summary.totalLoans,
          totalPendingAmount: (parseFloat(acc.totalPendingAmount) + parseFloat(month.summary.totalPendingAmount)).toString(),
          totalBadDebtCandidate: (parseFloat(acc.totalBadDebtCandidate) + parseFloat(month.summary.totalBadDebtCandidate)).toString()
        }),
        { totalLoans: 0, totalPendingAmount: '0', totalBadDebtCandidate: '0' }
      )

      const routesInfo = routeId
        ? [{ id: routeId, name: 'Selected route' }]
        : await context.prisma.route.findMany({
            select: { id: true, name: true }
          })

      return {
        year,
        monthlySummary,
        yearTotals,
        routesInfo
      }
    },

    deadDebtSummaryByLocality: async (
      _parent: unknown,
      args: {
        weeksSinceLoanMin?: number | null
        weeksWithoutPaymentMin?: number | null
        routeId?: string | null
        localities?: string[] | null
        badDebtStatus?: 'ALL' | 'MARKED' | 'UNMARKED' | null
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, [UserRole.ADMIN])

      const now = new Date()
      const filters: DeadDebtFilters = { ...args }
      const whereClause = buildLoanFilters(filters, now)

      let loans = await context.prisma.loan.findMany({
        where: whereClause,
        include: {
          leadRelation: {
            include: {
              personalDataRelation: {
                include: {
                  addresses: {
                    include: {
                      locationRelation: true
                    }
                  }
                }
              }
            }
          }
        }
      })

      // Filter by route using historical route lookup (consistent with portfolioReportMonthly)
      if (args.routeId) {
        const locationHistoryService = new LocationHistoryService(context.prisma)
        loans = await locationHistoryService.filterEntitiesByHistoricalRoute(
          loans, args.routeId, now, getLoanLocationId
        )
      }

      loans = filterByLocalities(loans, args.localities)

      const summaryMap = new Map<string, { loanCount: number; totalPending: number; totalBadDebtCandidate: number }>()

      loans.forEach(loan => {
        const locality = loan.leadRelation?.personalDataRelation?.addresses?.[0]?.locationRelation?.name || 'No locality'
        const pendingAmount = toDecimal(loan.pendingAmountStored)
        const badDebtCandidate = calculateBadDebtCandidate(loan)

        const current = summaryMap.get(locality) || { loanCount: 0, totalPending: 0, totalBadDebtCandidate: 0 }
        current.loanCount += 1
        current.totalPending += pendingAmount
        current.totalBadDebtCandidate += badDebtCandidate
        summaryMap.set(locality, current)
      })

      return Array.from(summaryMap.entries()).map(([locality, data]) => ({
        locality,
        loanCount: data.loanCount,
        totalPending: data.totalPending.toString(),
        totalBadDebtCandidate: data.totalBadDebtCandidate.toString()
      }))
    },

    recoveredDeadDebt: async (
      _parent: unknown,
      args: {
        year: number
        month: number
        routeId?: string | null
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, [UserRole.ADMIN])

      const { year, month, routeId } = args

      // Calculate date range for the month
      const monthStart = new Date(year, month - 1, 1)
      const monthEnd = new Date(year, month, 0, 23, 59, 59, 999)

      // Build where clause for loans (without route filter - done after with historical lookup)
      const loanWhere: any = {
        badDebtDate: {
          not: null,
          lt: monthStart
        }
      }

      // Route filter removed - now done via LocationHistoryService after query

      // Find all payments in the period from loans that were marked as dead debt BEFORE the payment date
      let payments = await context.prisma.loanPayment.findMany({
        where: {
          receivedAt: {
            gte: monthStart,
            lte: monthEnd
          },
          loanRelation: loanWhere
        },
        include: {
          loanRelation: {
            include: {
              borrowerRelation: {
                include: {
                  personalDataRelation: true
                }
              },
              leadRelation: {
                include: {
                  personalDataRelation: {
                    include: {
                      addresses: {
                        include: {
                          locationRelation: true
                        }
                      }
                    }
                  },
                  routes: true
                }
              }
            }
          }
        },
        orderBy: { receivedAt: 'desc' }
      })

      // Filter by route using historical route lookup (consistent with portfolioReportMonthly)
      if (routeId) {
        const locationHistoryService = new LocationHistoryService(context.prisma)

        // Get unique location IDs from payments' loans
        const locationIds = new Set<string>()
        const paymentLocationMap = new Map<string, string>()

        for (const payment of payments) {
          const loan = (payment as any).loanRelation
          const locationId = loan?.leadRelation?.personalDataRelation?.addresses?.[0]?.location
          if (locationId) {
            locationIds.add(locationId)
            paymentLocationMap.set(payment.id, locationId)
          }
        }

        if (locationIds.size > 0) {
          // Batch lookup routes for all locations at the reference date (now)
          const routeLookups = Array.from(locationIds).map(locationId => ({
            locationId,
            date: new Date()
          }))

          const historicalRouteMap = await locationHistoryService.getRoutesForLocationsAtDates(routeLookups)

          // Filter payments where the loan's lead location was in the specified route
          payments = payments.filter(payment => {
            const locationId = paymentLocationMap.get(payment.id)
            if (!locationId) return false

            const key = `${locationId}:${new Date().toISOString()}`
            const routeInfo = historicalRouteMap.get(key)
            return routeInfo?.routeId === routeId
          })
        } else {
          payments = []
        }
      }

      // Calculate summary
      const totalRecovered = payments.reduce((sum, p) => sum + toDecimal(p.amount), 0)
      const uniqueLoanIds = new Set(payments.map(p => p.loan))
      const uniqueClientIds = new Set(
        payments
          .map(p => (p as any).loanRelation?.borrower)
          .filter(Boolean)
      )

      // Map payments to result format
      const processedPayments = payments.map(payment => {
        const loan = (payment as any).loanRelation
        const borrower = loan?.borrowerRelation?.personalDataRelation
        const lead = loan?.leadRelation
        const leadPersonalData = lead?.personalDataRelation

        return {
          id: payment.id,
          amount: toDecimal(payment.amount).toString(),
          receivedAt: payment.receivedAt?.toISOString() || new Date().toISOString(),
          loanId: payment.loan || '',
          clientName: borrower?.fullName || 'Unknown',
          clientCode: borrower?.clientCode || 'N/A',
          badDebtDate: loan?.badDebtDate?.toISOString() || '',
          routeName: lead?.routes?.[0]?.name || 'No route',
          locality: leadPersonalData?.addresses?.[0]?.locationRelation?.name || 'No locality',
          pendingAmount: toDecimal(loan?.pendingAmountStored).toString()
        }
      })

      return {
        year,
        month,
        summary: {
          totalRecovered: totalRecovered.toString(),
          paymentsCount: payments.length,
          loansCount: uniqueLoanIds.size,
          clientsCount: uniqueClientIds.size
        },
        payments: processedPayments
      }
    }
  },

  Mutation: {
    markLoansAsDeadDebt: async (
      _parent: unknown,
      args: { loanIds: string[]; deadDebtDate: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, [UserRole.ADMIN])

      try {
        const result = await context.prisma.loan.updateMany({
          where: {
            id: { in: args.loanIds },
            badDebtDate: null
          },
          data: {
            badDebtDate: new Date(args.deadDebtDate)
          }
        })

        return {
          success: true,
          message: `${result.count} loans marked as dead debt successfully`,
          count: result.count
        }
      } catch (error) {
        console.error('Error marking loans as dead debt:', error)
        return {
          success: false,
          message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          count: 0
        }
      }
    }
  }
}
