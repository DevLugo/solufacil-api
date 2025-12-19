import { Decimal } from 'decimal.js'
import type { PrismaClient, Loan, LoanPayment } from '@solufacil/database'
import {
  getActiveWeekRange,
  getWeeksInMonth,
  getPreviousWeek,
  isInCarteraVencida,
  calculateClientBalance,
  calculateRenovationKPIs,
  countClientsStatus,
  type WeekRange,
  type LoanForPortfolio,
  type PaymentForCV,
  type PortfolioReport,
  type PortfolioSummary,
  type WeeklyPortfolioData,
  type LocationBreakdown,
  type RenovationKPIs,
  type ActiveClientStatus,
  type CVStatus,
  type PeriodType,
  type LocalityReport,
  type LocalityBreakdown as LocalityBreakdownType,
  type LocalityWeekData,
  type LocalitySummary,
  type LocalityClientDetail,
  type ClientCategory,
} from '@solufacil/business-logic'

export interface PortfolioFilters {
  locationIds?: string[]
  routeIds?: string[]
  loantypeIds?: string[]
}

// Type for loan with included relations
type LoanWithRelations = Loan & {
  payments: LoanPayment[]
  borrowerRelation?: {
    personalDataRelation?: {
      fullName: string
    } | null
  } | null
}

export class PortfolioReportService {
  constructor(private prisma: PrismaClient) {}

  // ========== Helper Methods for Building Queries ==========

  /**
   * Builds the base WHERE clause for querying active loans.
   * An active loan is one that:
   * - Has pending amount > 0
   * - Is not marked as bad debt
   * - Is not excluded by cleanup
   * - Has not been renewed (renewedDate is null)
   * - Has not been finished (finishedDate is null)
   *
   * @param filters - Optional filters for routes, loan types, and locations
   * @param options - Configuration options for the where clause
   * @returns Prisma-compatible where clause object
   */
  private buildActiveLoansWhereClause(
    filters?: PortfolioFilters,
    options: {
      /** Use OR condition for route filtering (snapshotRouteId OR lead's routes) */
      useRouteOrCondition?: boolean
      /** Include location filter based on borrower's address */
      includeLocationFilter?: boolean
    } = {}
  ): Record<string, unknown> {
    const { useRouteOrCondition = true, includeLocationFilter = false } = options

    const whereClause: Record<string, unknown> = {
      pendingAmountStored: { gt: 0 },
      badDebtDate: null,
      excludedByCleanup: null,
      renewedDate: null,
      finishedDate: null,
    }

    // Apply route filter
    if (filters?.routeIds?.length) {
      if (useRouteOrCondition) {
        // Include loans matching snapshotRouteId OR lead's assigned routes
        whereClause.OR = [
          { snapshotRouteId: { in: filters.routeIds } },
          {
            leadRelation: {
              routes: {
                some: { id: { in: filters.routeIds } },
              },
            },
          },
        ]
      } else {
        // Simple filter by snapshotRouteId only
        whereClause.snapshotRouteId = { in: filters.routeIds }
      }
    }

    // Apply loan type filter
    if (filters?.loantypeIds?.length) {
      whereClause.loantype = { in: filters.loantypeIds }
    }

    // Apply location filter (based on borrower's address)
    if (includeLocationFilter && filters?.locationIds?.length) {
      whereClause.borrowerRelation = {
        personalDataRelation: {
          addresses: {
            some: { location: { in: filters.locationIds } },
          },
        },
      }
    }

    return whereClause
  }

  // ========== Public Methods ==========

  /**
   * Gets the current active week range
   */
  getCurrentActiveWeek(): WeekRange {
    return getActiveWeekRange(new Date())
  }

  /**
   * Checks if a week is completed (the Sunday has passed)
   *
   * @param week - The week to check
   * @returns true if the week is complete (we're past Sunday 23:59:59)
   */
  private isWeekCompleted(week: WeekRange): boolean {
    const now = new Date()
    return now > week.end
  }

  /**
   * Gets only the completed weeks from an array of weeks
   * A week is completed when the current date is past the week's end (Sunday 23:59:59)
   *
   * @param weeks - Array of weeks to filter
   * @returns Only the weeks that have been completed
   */
  private getCompletedWeeks(weeks: WeekRange[]): WeekRange[] {
    return weeks.filter((week) => this.isWeekCompleted(week))
  }

  /**
   * Gets the last completed week for CV calculation
   * If no weeks are completed yet, returns null
   *
   * @param weeks - Array of weeks in the period
   * @returns The last completed week, or null if none are completed
   */
  private getLastCompletedWeek(weeks: WeekRange[]): WeekRange | null {
    const completedWeeks = this.getCompletedWeeks(weeks)
    if (completedWeeks.length === 0) {
      return null
    }
    return completedWeeks[completedWeeks.length - 1]
  }

  /**
   * Gets a weekly portfolio report
   */
  async getWeeklyReport(
    year: number,
    weekNumber: number,
    filters?: PortfolioFilters
  ): Promise<PortfolioReport> {
    const targetDate = this.getDateFromWeekNumber(year, weekNumber)
    const activeWeek = getActiveWeekRange(targetDate)
    const previousWeek = getPreviousWeek(activeWeek)

    const { loans, paymentsMap } = await this.getActiveLoansWithPayments(
      activeWeek,
      filters
    )

    const summary = await this.calculateSummary(
      loans,
      paymentsMap,
      activeWeek,
      previousWeek,
      activeWeek.start,
      activeWeek.end
    )

    const weeklyData: WeeklyPortfolioData[] = [
      {
        weekRange: activeWeek,
        clientesActivos: summary.totalClientesActivos,
        clientesEnCV: summary.clientesEnCV,
        balance: summary.clientBalance.balance,
        isCompleted: this.isWeekCompleted(activeWeek),
      },
    ]

    const byLocation = await this.getRouteBreakdown(
      loans,
      paymentsMap,
      activeWeek,
      filters
    )

    const renovationKPIs = await this.getRenovationKPIs(
      activeWeek.start,
      activeWeek.end,
      filters
    )

    return {
      reportDate: new Date(),
      periodType: 'WEEKLY' as PeriodType,
      year,
      weekNumber,
      summary,
      weeklyData,
      byLocation,
      renovationKPIs,
    }
  }

  /**
   * Gets a monthly portfolio report
   *
   * CV is calculated as the AVERAGE of completed weeks only.
   * A week is "completed" when we're past Sunday 23:59:59.
   * If no weeks are completed yet, CV will be 0 and semanasCompletadas will be 0.
   */
  async getMonthlyReport(
    year: number,
    month: number,
    filters?: PortfolioFilters
  ): Promise<PortfolioReport> {
    const weeks = getWeeksInMonth(year, month - 1)

    if (weeks.length === 0) {
      throw new Error(`No weeks found for ${year}-${month}`)
    }

    const periodStart = weeks[0].start
    const periodEnd = weeks[weeks.length - 1].end

    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    const previousWeeks = getWeeksInMonth(prevYear, prevMonth - 1)
    const previousPeriodStart =
      previousWeeks.length > 0 ? previousWeeks[0].start : null
    const previousPeriodEnd =
      previousWeeks.length > 0
        ? previousWeeks[previousWeeks.length - 1].end
        : null

    // Get completed weeks for CV calculation
    const completedWeeks = this.getCompletedWeeks(weeks)
    const lastCompletedWeek = this.getLastCompletedWeek(weeks)
    const previousWeek = completedWeeks.length > 1 ? completedWeeks[completedWeeks.length - 2] : null

    // Build weekly data for ALL weeks (completed and not)
    const weeklyData: WeeklyPortfolioData[] = []
    let totalCVFromCompletedWeeks = 0

    for (const week of weeks) {
      const isCompleted = this.isWeekCompleted(week)
      const { loans: weekLoans, paymentsMap: weekPaymentsMap } =
        await this.getActiveLoansWithPayments(week, filters)
      const weekStatus = countClientsStatus(weekLoans, weekPaymentsMap, week)
      const weekBalance = calculateClientBalance(
        weekLoans,
        week.start,
        week.end
      )

      // Only count CV from completed weeks for the average
      if (isCompleted) {
        totalCVFromCompletedWeeks += weekStatus.enCV
      }

      weeklyData.push({
        weekRange: week,
        clientesActivos: weekStatus.totalActivos,
        clientesEnCV: isCompleted ? weekStatus.enCV : 0, // Only show CV for completed weeks
        balance: weekBalance.balance,
        isCompleted,
      })
    }

    // Calculate average CV from completed weeks
    const promedioCV = completedWeeks.length > 0
      ? Math.round(totalCVFromCompletedWeeks / completedWeeks.length)
      : 0

    // Get loans for the last completed week (or use empty data if no completed weeks)
    let loans: LoanForPortfolio[] = []
    let paymentsMap = new Map<string, PaymentForCV[]>()

    if (lastCompletedWeek) {
      const result = await this.getActiveLoansWithPayments(lastCompletedWeek, filters)
      loans = result.loans
      paymentsMap = result.paymentsMap
    } else if (weeks.length > 0) {
      // If no completed weeks, get current active loans for count purposes
      const result = await this.getActiveLoansWithPayments(weeks[0], filters)
      loans = result.loans
      paymentsMap = result.paymentsMap
    }

    // Calculate summary using last completed week data
    const summary = await this.calculateSummaryForMonth(
      loans,
      paymentsMap,
      lastCompletedWeek,
      previousWeek,
      periodStart,
      periodEnd,
      previousPeriodStart,
      previousPeriodEnd,
      promedioCV,
      completedWeeks.length,
      weeks.length
    )

    // Use last completed week for route breakdown, or first week if none completed
    const weekForBreakdown = lastCompletedWeek || weeks[0]
    const byLocation = await this.getRouteBreakdown(
      loans,
      paymentsMap,
      weekForBreakdown,
      filters
    )

    const renovationKPIs = await this.getRenovationKPIs(
      periodStart,
      periodEnd,
      filters
    )

    return {
      reportDate: new Date(),
      periodType: 'MONTHLY' as PeriodType,
      year,
      month,
      summary,
      weeklyData,
      byLocation,
      renovationKPIs,
    }
  }

  /**
   * Gets active clients with their CV status
   * Uses the last completed week for CV calculation
   */
  async getActiveClientsWithCVStatus(
    filters?: PortfolioFilters
  ): Promise<ActiveClientStatus[]> {
    const currentWeek = getActiveWeekRange(new Date())
    // Use the previous week if current week is not completed
    // This ensures we have a full week of data for CV calculation
    const activeWeek = this.isWeekCompleted(currentWeek)
      ? currentWeek
      : getPreviousWeek(currentWeek)

    const whereClause = this.buildActiveLoansWhereClause(filters)

    const loans = await this.prisma.loan.findMany({
      where: whereClause,
      include: {
        payments: {
          where: {
            receivedAt: {
              gte: activeWeek.start,
              lte: activeWeek.end,
            },
          },
        },
        borrowerRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        snapshotRoute: true,
        leadRelation: {
          include: {
            routes: true,
          },
        },
      },
    })

    // Also get last payment for "days since last payment" calculation
    const loanIds = loans.map((l) => l.id)
    const lastPayments = await this.prisma.loanPayment.findMany({
      where: {
        loan: { in: loanIds },
      },
      orderBy: { receivedAt: 'desc' },
      distinct: ['loan'],
    })
    const lastPaymentMap = new Map(lastPayments.map((p) => [p.loan, p]))

    const result: ActiveClientStatus[] = []

    for (const loan of loans) {
      const loanForPortfolio = this.toLoanForPortfolio(loan)
      const payments = this.toPaymentsForCV(loan.payments)

      const inCV = isInCarteraVencida(loanForPortfolio, payments, activeWeek)
      const lastPayment = lastPaymentMap.get(loan.id)

      let daysSinceLastPayment: number | null = null
      if (lastPayment) {
        const diffTime = Date.now() - lastPayment.receivedAt.getTime()
        daysSinceLastPayment = Math.floor(diffTime / (1000 * 60 * 60 * 24))
      }

      // Get lead's routes (M:M relation) - take the first one
      const leadRoutes = loan.leadRelation?.routes || []
      const leadRoute = leadRoutes.length > 0 ? leadRoutes[0] : null

      // PRIORITY: Use snapshotRouteId first (synced from lead's locality), then lead's route as fallback
      // Priority for route name:
      // 1. snapshotRoute.name (JOIN with Route using snapshotRouteId)
      // 2. leadRoute.name (lead's current route from M:M relation)
      // 3. snapshotRouteName (stored snapshot field)
      // 4. 'Sin ruta'
      const routeName =
        loan.snapshotRoute?.name ||
        leadRoute?.name ||
        loan.snapshotRouteName ||
        'Sin ruta'

      result.push({
        loanId: loan.id,
        borrowerId: loan.borrower,
        clientName:
          loan.borrowerRelation?.personalDataRelation?.fullName || 'N/A',
        pendingAmount: new Decimal(loan.pendingAmountStored).toNumber(),
        cvStatus: inCV ? ('EN_CV' as CVStatus) : ('AL_CORRIENTE' as CVStatus),
        daysSinceLastPayment,
        locationName: routeName,
        routeName: routeName,
      })
    }

    return result
  }

  /**
   * Gets a locality report with weekly breakdown
   * Groups loans by borrower's locality (from their address)
   */
  async getLocalityReport(
    year: number,
    month: number,
    filters?: PortfolioFilters
  ): Promise<LocalityReport> {
    const weeks = getWeeksInMonth(year, month - 1)

    if (weeks.length === 0) {
      throw new Error(`No weeks found for ${year}-${month}`)
    }

    // Map to store locality data: localityId -> { info, weeklyData[] }
    const localitiesMap = new Map<
      string,
      {
        localityId: string
        localityName: string
        routeId?: string
        routeName?: string
        weeklyDataMap: Map<number, LocalityWeekData>
      }
    >()

    // Process each week
    for (const week of weeks) {
      // Only calculate CV for completed weeks
      const isCompleted = this.isWeekCompleted(week)

      const loansWithLocality = await this.getLoansWithBorrowerLocality(
        week,
        filters
      )

      // Group loans by locality
      const loansByLocality = new Map<
        string,
        {
          localityId: string
          localityName: string
          routeId?: string
          routeName?: string
          loans: (LoanForPortfolio & { isNew: boolean; isRenewed: boolean; isReintegro: boolean; isFinished: boolean; isActive: boolean })[]
          paymentsMap: Map<string, PaymentForCV[]>
        }
      >()

      for (const loan of loansWithLocality) {
        const localityId = loan.localityId || 'sin-localidad'
        const localityName = loan.localityName || 'Sin Localidad'

        if (!loansByLocality.has(localityId)) {
          loansByLocality.set(localityId, {
            localityId,
            localityName,
            routeId: loan.routeId,
            routeName: loan.routeName,
            loans: [],
            paymentsMap: new Map(),
          })
        }

        const entry = loansByLocality.get(localityId)!
        entry.loans.push({
          id: loan.id,
          pendingAmountStored: loan.pendingAmountStored,
          signDate: loan.signDate,
          finishedDate: loan.finishedDate,
          renewedDate: loan.renewedDate,
          badDebtDate: loan.badDebtDate,
          excludedByCleanup: loan.excludedByCleanup,
          previousLoan: loan.previousLoan,
          isNew: loan.isNew,
          isRenewed: loan.isRenewed,
          isReintegro: loan.isReintegro,
          isFinished: loan.isFinished,
          isActive: loan.isActive,
        })
        entry.paymentsMap.set(loan.id, loan.payments)
      }

      // Calculate metrics for each locality for this week
      for (const [localityId, data] of loansByLocality) {
        // Ensure locality exists in main map
        if (!localitiesMap.has(localityId)) {
          localitiesMap.set(localityId, {
            localityId: data.localityId,
            localityName: data.localityName,
            routeId: data.routeId,
            routeName: data.routeName,
            weeklyDataMap: new Map(),
          })
        }

        const localityEntry = localitiesMap.get(localityId)!

        // Filter only active loans for counting active clients and CV status
        const activeLoans = data.loans.filter((l) => l.isActive)
        const activeBaseLoanData = activeLoans.map((l) => ({
          id: l.id,
          pendingAmountStored: l.pendingAmountStored,
          signDate: l.signDate,
          finishedDate: l.finishedDate,
          renewedDate: l.renewedDate,
          badDebtDate: l.badDebtDate,
          excludedByCleanup: l.excludedByCleanup,
          previousLoan: l.previousLoan,
        }))

        // Create payments map only for active loans
        const activePaymentsMap = new Map<string, PaymentForCV[]>()
        for (const loan of activeLoans) {
          activePaymentsMap.set(loan.id, data.paymentsMap.get(loan.id) || [])
        }

        const status = countClientsStatus(activeBaseLoanData, activePaymentsMap, week)
        const balance = calculateClientBalance(activeBaseLoanData, week.start, week.end)

        // Count movements (from all loans, not just active)
        const nuevos = data.loans.filter((l) => l.isNew).length
        const renovados = data.loans.filter((l) => l.isRenewed).length
        const reintegros = data.loans.filter((l) => l.isReintegro).length
        const finalizados = data.loans.filter((l) => l.isFinished).length

        // Only count CV for completed weeks
        const weekData: LocalityWeekData = {
          weekRange: week,
          clientesActivos: status.totalActivos,
          clientesAlCorriente: isCompleted ? status.alCorriente : status.totalActivos,
          clientesEnCV: isCompleted ? status.enCV : 0, // Only show CV for completed weeks
          nuevos,
          renovados,
          reintegros,
          finalizados,
          balance: balance.balance,
          isCompleted,
        }

        localityEntry.weeklyDataMap.set(week.weekNumber, weekData)
      }
    }

    // Build final localities array with summaries
    const localities: LocalityBreakdownType[] = []

    for (const [, localityData] of localitiesMap) {
      const weeklyData: LocalityWeekData[] = []

      // Fill in data for all weeks (some localities may not have loans in all weeks)
      for (const week of weeks) {
        const data = localityData.weeklyDataMap.get(week.weekNumber)
        if (data) {
          weeklyData.push(data)
        } else {
          // No data for this week means 0 clients
          weeklyData.push({
            weekRange: week,
            clientesActivos: 0,
            clientesAlCorriente: 0,
            clientesEnCV: 0,
            nuevos: 0,
            renovados: 0,
            reintegros: 0,
            finalizados: 0,
            balance: 0,
            isCompleted: this.isWeekCompleted(week),
          })
        }
      }

      // Calculate summary from weekly data
      // Find last completed week for summary values
      const completedWeeksData = weeklyData.filter((_, idx) => this.isWeekCompleted(weeks[idx]))
      const lastCompletedWeekData = completedWeeksData.length > 0
        ? completedWeeksData[completedWeeksData.length - 1]
        : null

      const totalNuevos = weeklyData.reduce((sum, w) => sum + w.nuevos, 0)
      const totalRenovados = weeklyData.reduce((sum, w) => sum + w.renovados, 0)
      const totalReintegros = weeklyData.reduce((sum, w) => sum + w.reintegros, 0)
      const totalFinalizados = weeklyData.reduce((sum, w) => sum + w.finalizados, 0)
      const totalBalance = weeklyData.reduce((sum, w) => sum + w.balance, 0)

      // Averages only from completed weeks
      const alCorrientePromedio =
        completedWeeksData.length > 0
          ? completedWeeksData.reduce((sum, w) => sum + w.clientesAlCorriente, 0) / completedWeeksData.length
          : 0

      const cvPromedio =
        completedWeeksData.length > 0
          ? completedWeeksData.reduce((sum, w) => sum + w.clientesEnCV, 0) / completedWeeksData.length
          : 0

      // Use last completed week for activos/alCorriente, or last week data if none completed
      const summaryWeekData = lastCompletedWeekData || weeklyData[weeklyData.length - 1]
      const porcentajePagando =
        summaryWeekData.clientesActivos > 0
          ? (summaryWeekData.clientesAlCorriente / summaryWeekData.clientesActivos) * 100
          : 0

      const summary: LocalitySummary = {
        totalClientesActivos: summaryWeekData.clientesActivos,
        totalClientesAlCorriente: summaryWeekData.clientesAlCorriente,
        totalClientesEnCV: summaryWeekData.clientesEnCV, // Use last completed week's CV (consistent with detail modal)
        totalNuevos,
        totalRenovados,
        totalReintegros,
        totalFinalizados,
        balance: totalBalance,
        alCorrientePromedio,
        cvPromedio,
        porcentajePagando,
      }

      localities.push({
        localityId: localityData.localityId,
        localityName: localityData.localityName,
        routeId: localityData.routeId,
        routeName: localityData.routeName,
        weeklyData,
        summary,
      })
    }

    // Sort by total active clients descending
    localities.sort((a, b) => b.summary.totalClientesActivos - a.summary.totalClientesActivos)

    // Calculate global totals
    const totals: LocalitySummary = {
      totalClientesActivos: localities.reduce((sum, l) => sum + l.summary.totalClientesActivos, 0),
      totalClientesAlCorriente: localities.reduce((sum, l) => sum + l.summary.totalClientesAlCorriente, 0),
      totalClientesEnCV: localities.reduce((sum, l) => sum + l.summary.totalClientesEnCV, 0),
      totalNuevos: localities.reduce((sum, l) => sum + l.summary.totalNuevos, 0),
      totalRenovados: localities.reduce((sum, l) => sum + l.summary.totalRenovados, 0),
      totalReintegros: localities.reduce((sum, l) => sum + l.summary.totalReintegros, 0),
      totalFinalizados: localities.reduce((sum, l) => sum + l.summary.totalFinalizados, 0),
      balance: localities.reduce((sum, l) => sum + l.summary.balance, 0),
      // Sum all locality averages (represents total across all localities)
      alCorrientePromedio: localities.reduce((sum, l) => sum + l.summary.alCorrientePromedio, 0),
      cvPromedio: localities.reduce((sum, l) => sum + l.summary.cvPromedio, 0),
      porcentajePagando:
        localities.length > 0
          ? localities.reduce((sum, l) => sum + l.summary.porcentajePagando, 0) / localities.length
          : 0,
    }

    return {
      periodType: 'MONTHLY' as PeriodType,
      year,
      month,
      weeks,
      localities,
      totals,
    }
  }

  /**
   * Gets clients for a specific locality (for drill-down modal)
   *
   * IMPORTANT: Locality is determined by the LEAD's address, not the borrower's,
   * to be consistent with getLoansWithBorrowerLocality and portfolioByLocality.
   */
  async getLocalityClients(
    localityId: string,
    year: number,
    month: number,
    weekNumber?: number,
    category?: ClientCategory
  ): Promise<LocalityClientDetail[]> {
    const weeks = getWeeksInMonth(year, month - 1)
    if (weeks.length === 0) {
      return []
    }

    // Determine the week range to use
    // IMPORTANT: Use last COMPLETED week (consistent with getLocalityReport summary)
    // If a specific weekNumber is provided, use that week
    // Otherwise, use the last completed week (or last week if none completed)
    let targetWeek: WeekRange
    if (weekNumber) {
      targetWeek = weeks.find((w) => w.weekNumber === weekNumber) || weeks[weeks.length - 1]
    } else {
      const lastCompletedWeek = this.getLastCompletedWeek(weeks)
      targetWeek = lastCompletedWeek || weeks[weeks.length - 1]
    }

    // Query loans filtering by LEAD's locality (not borrower's)
    // This is consistent with portfolioByLocality grouping
    const whereClause: any = {
      pendingAmountStored: { gt: 0 },
      badDebtDate: null,
      excludedByCleanup: null,
      renewedDate: null,
      finishedDate: null,
    }

    // Filter by lead's locality
    if (localityId === 'sin-localidad') {
      // Loans where lead has no address
      whereClause.leadRelation = {
        personalDataRelation: {
          addresses: {
            none: {},
          },
        },
      }
    } else {
      // Loans where lead's address is in the specified locality
      whereClause.leadRelation = {
        personalDataRelation: {
          addresses: {
            some: {
              location: localityId,
            },
          },
        },
      }
    }

    const loans = await this.prisma.loan.findMany({
      where: whereClause,
      include: {
        borrowerRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        leadRelation: {
          include: {
            personalDataRelation: {
              include: {
                addresses: {
                  take: 1,
                  include: {
                    locationRelation: true,
                  },
                },
              },
            },
          },
        },
        loantypeRelation: true,
        payments: {
          where: {
            receivedAt: {
              gte: targetWeek.start,
              lte: targetWeek.end,
            },
          },
        },
      },
    })

    const result: LocalityClientDetail[] = []

    for (const loan of loans) {
      const personalData = loan.borrowerRelation?.personalDataRelation
      const loanForPortfolio = this.toLoanForPortfolio(loan)
      const payments = this.toPaymentsForCV(loan.payments)
      const inCV = isInCarteraVencida(loanForPortfolio, payments, targetWeek)

      // Determine category
      const isNewInWeek =
        loan.signDate >= targetWeek.start &&
        loan.signDate <= targetWeek.end &&
        !loan.previousLoan
      const isRenewedInWeek =
        loan.renewedDate &&
        loan.renewedDate >= targetWeek.start &&
        loan.renewedDate <= targetWeek.end
      const isFinishedInWeek =
        loan.finishedDate &&
        loan.finishedDate >= targetWeek.start &&
        loan.finishedDate <= targetWeek.end

      // Determine if it's a reintegro (renewed with same or less amount - simplified check)
      const isReintegro = isRenewedInWeek && loan.previousLoan !== null

      let clientCategory: ClientCategory = 'ACTIVO'
      if (inCV) {
        clientCategory = 'EN_CV'
      } else if (isNewInWeek) {
        clientCategory = 'NUEVO'
      } else if (isReintegro) {
        clientCategory = 'REINTEGRO'
      } else if (isRenewedInWeek) {
        clientCategory = 'RENOVADO'
      } else if (isFinishedInWeek) {
        clientCategory = 'FINALIZADO'
      }

      // Filter by category if specified
      if (category && clientCategory !== category) {
        continue
      }

      // Calculate days since last payment
      let daysSinceLastPayment: number | null = null
      const lastPayment = loan.payments[0]
      if (lastPayment) {
        const diffTime = Date.now() - lastPayment.receivedAt.getTime()
        daysSinceLastPayment = Math.floor(diffTime / (1000 * 60 * 60 * 24))
      }

      result.push({
        loanId: loan.id,
        clientName: personalData?.fullName || 'N/A',
        clientCode: personalData?.clientCode || '',
        amountGived: new Decimal(loan.amountGived).toNumber(),
        pendingAmount: new Decimal(loan.pendingAmountStored).toNumber(),
        signDate: loan.signDate,
        cvStatus: inCV ? ('EN_CV' as CVStatus) : ('AL_CORRIENTE' as CVStatus),
        daysSinceLastPayment,
        loanType: loan.loantypeRelation?.name || 'N/A',
        category: clientCategory,
      })
    }

    return result.sort((a, b) => a.clientName.localeCompare(b.clientName))
  }

  // ========== Private Helper Methods ==========

  /**
   * Gets loans with borrower locality information for a given week
   *
   * IMPORTANT: A loan is considered "active" only if:
   * - renewedDate is null (hasn't been renewed - the NEW loan is active, not the old one)
   * - finishedDate is null (hasn't finished paying)
   *
   * For movements tracking (nuevos, renovados):
   * - "Nuevo" = new loan signed this week WITHOUT a previousLoan
   * - "Renovado" = new loan signed this week WITH a previousLoan (this is the NEW active loan)
   * - "Finalizado" = we need a separate query to track loans that finished this week
   */
  private async getLoansWithBorrowerLocality(
    weekRange: WeekRange,
    filters?: PortfolioFilters
  ) {
    const baseWhereClause = this.buildActiveLoansWhereClause(filters, {
      useRouteOrCondition: false,
      includeLocationFilter: true,
    })

    // Query 1: Get active loans
    const activeLoans = await this.prisma.loan.findMany({
      where: baseWhereClause,
      include: {
        // Include lead (loanOfficer) to get their locality
        leadRelation: {
          include: {
            personalDataRelation: {
              include: {
                addresses: {
                  take: 1,
                  include: {
                    locationRelation: {
                      include: {
                        routeRelation: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        payments: {
          where: {
            receivedAt: {
              gte: weekRange.start,
              lte: weekRange.end,
            },
          },
        },
      },
    })

    // Query 2: Get loans that finished this week (for "finalizados" count)
    const finishedWhereClause: any = {
      ...baseWhereClause,
      renewedDate: undefined, // Remove this filter
      finishedDate: {
        gte: weekRange.start,
        lte: weekRange.end,
      },
    }
    delete finishedWhereClause.finishedDate // Remove the null filter we set
    finishedWhereClause.finishedDate = {
      gte: weekRange.start,
      lte: weekRange.end,
    }
    // For finished loans, renewedDate should be null (finished without renewal)
    finishedWhereClause.renewedDate = null

    const finishedLoans = await this.prisma.loan.findMany({
      where: {
        badDebtDate: null,
        excludedByCleanup: null,
        renewedDate: null, // Finished without renewal
        finishedDate: {
          gte: weekRange.start,
          lte: weekRange.end,
        },
        ...(filters?.routeIds?.length && { snapshotRouteId: { in: filters.routeIds } }),
        ...(filters?.loantypeIds?.length && { loantype: { in: filters.loantypeIds } }),
      },
      include: {
        // Include lead (loanOfficer) to get their locality
        leadRelation: {
          include: {
            personalDataRelation: {
              include: {
                addresses: {
                  take: 1,
                  include: {
                    locationRelation: {
                      include: {
                        routeRelation: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    // Create a Set of finished loan IDs for quick lookup
    const finishedLoanIds = new Set(finishedLoans.map(l => l.id))

    // Map active loans
    const result = activeLoans.map((loan) => {
      // Get locality from lead's address
      const address = loan.leadRelation?.personalDataRelation?.addresses?.[0]
      const location = address?.locationRelation
      const locationRoute = location?.routeRelation

      // Route priority (consistent with getRouteBreakdown):
      // 1. snapshotRouteId (synced from lead assignment)
      // 2. Lead's locality route (fallback)
      const routeId = loan.snapshotRouteId || locationRoute?.id || undefined
      const routeName = loan.snapshotRouteName || locationRoute?.name || undefined

      // "Nuevo" = signed this week without a previous loan
      const isNew =
        loan.signDate >= weekRange.start &&
        loan.signDate <= weekRange.end &&
        !loan.previousLoan

      // "Renovado" = signed this week WITH a previous loan (this IS the new active loan)
      const isRenewed =
        loan.signDate >= weekRange.start &&
        loan.signDate <= weekRange.end &&
        loan.previousLoan !== null

      // Reintegro is a type of renovation
      const isReintegro = isRenewed

      return {
        id: loan.id,
        pendingAmountStored: new Decimal(loan.pendingAmountStored).toNumber(),
        signDate: loan.signDate,
        finishedDate: loan.finishedDate,
        renewedDate: loan.renewedDate,
        badDebtDate: loan.badDebtDate,
        excludedByCleanup: loan.excludedByCleanup,
        previousLoan: loan.previousLoan,
        status: loan.status,
        localityId: location?.id,
        localityName: location?.name,
        routeId,
        routeName,
        payments: this.toPaymentsForCV(loan.payments),
        isNew,
        isRenewed,
        isReintegro,
        isFinished: false, // Active loans are not finished
        isActive: true,
      }
    })

    // Add finished loans (for counting purposes, marked as not active)
    for (const loan of finishedLoans) {
      // Skip if already in active loans (shouldn't happen with our filters)
      if (result.find(r => r.id === loan.id)) continue

      // Get locality from lead's address
      const address = loan.leadRelation?.personalDataRelation?.addresses?.[0]
      const location = address?.locationRelation
      const locationRoute = location?.routeRelation

      // Route priority (consistent with getRouteBreakdown):
      // 1. snapshotRouteId (synced from lead assignment)
      // 2. Lead's locality route (fallback)
      const routeId = loan.snapshotRouteId || locationRoute?.id || undefined
      const routeName = loan.snapshotRouteName || locationRoute?.name || undefined

      result.push({
        id: loan.id,
        pendingAmountStored: new Decimal(loan.pendingAmountStored).toNumber(),
        signDate: loan.signDate,
        finishedDate: loan.finishedDate,
        renewedDate: loan.renewedDate,
        badDebtDate: loan.badDebtDate,
        excludedByCleanup: loan.excludedByCleanup,
        previousLoan: loan.previousLoan,
        status: loan.status,
        localityId: location?.id,
        localityName: location?.name,
        routeId,
        routeName,
        payments: [],
        isNew: false,
        isRenewed: false,
        isReintegro: false,
        isFinished: true,
        isActive: false, // Finished loans are not active
      })
    }

    return result
  }

  private getDateFromWeekNumber(year: number, weekNumber: number): Date {
    const jan4 = new Date(year, 0, 4)
    const dayOfWeek = jan4.getDay() || 7
    const firstMonday = new Date(jan4)
    firstMonday.setDate(jan4.getDate() - dayOfWeek + 1)

    const targetDate = new Date(firstMonday)
    targetDate.setDate(firstMonday.getDate() + (weekNumber - 1) * 7)

    return targetDate
  }

  private toLoanForPortfolio(loan: Loan): LoanForPortfolio {
    return {
      id: loan.id,
      pendingAmountStored: new Decimal(loan.pendingAmountStored).toNumber(),
      signDate: loan.signDate,
      finishedDate: loan.finishedDate,
      renewedDate: loan.renewedDate,
      badDebtDate: loan.badDebtDate,
      excludedByCleanup: loan.excludedByCleanup,
      previousLoan: loan.previousLoan,
      status: loan.status,
    }
  }

  private toPaymentsForCV(payments: LoanPayment[]): PaymentForCV[] {
    return payments.map((p) => ({
      id: p.id,
      receivedAt: p.receivedAt,
      amount: new Decimal(p.amount).toNumber(),
    }))
  }

  async getActiveLoansWithPayments(
    weekRange: WeekRange,
    filters?: PortfolioFilters
  ): Promise<{
    loans: LoanForPortfolio[]
    paymentsMap: Map<string, PaymentForCV[]>
  }> {
    const whereClause = this.buildActiveLoansWhereClause(filters)

    const dbLoans = await this.prisma.loan.findMany({
      where: whereClause,
      include: {
        payments: {
          where: {
            receivedAt: {
              gte: weekRange.start,
              lte: weekRange.end,
            },
          },
        },
        leadRelation: filters?.routeIds?.length
          ? {
              include: {
                routes: true,
              },
            }
          : false,
      },
    })

    const loans = dbLoans.map((loan) => this.toLoanForPortfolio(loan))
    const paymentsMap = new Map<string, PaymentForCV[]>()

    for (const loan of dbLoans) {
      paymentsMap.set(loan.id, this.toPaymentsForCV(loan.payments))
    }

    return { loans, paymentsMap }
  }

  private async calculateSummary(
    loans: LoanForPortfolio[],
    paymentsMap: Map<string, PaymentForCV[]>,
    activeWeek: WeekRange,
    previousWeek: WeekRange | null,
    periodStart: Date,
    periodEnd: Date,
    previousPeriodStart?: Date | null,
    previousPeriodEnd?: Date | null
  ): Promise<PortfolioSummary> {
    const status = countClientsStatus(loans, paymentsMap, activeWeek)
    const clientBalance = calculateClientBalance(loans, periodStart, periodEnd)

    let comparison = null
    if (previousPeriodStart && previousPeriodEnd && previousWeek) {
      const { loans: prevLoans, paymentsMap: prevPaymentsMap } =
        await this.getActiveLoansWithPayments(previousWeek)
      const prevStatus = countClientsStatus(
        prevLoans,
        prevPaymentsMap,
        previousWeek
      )
      const prevBalance = calculateClientBalance(
        prevLoans,
        previousPeriodStart,
        previousPeriodEnd
      )

      comparison = {
        previousPeriod: {
          clientesActivos: prevStatus.totalActivos,
          clientesEnCV: prevStatus.enCV,
          balance: prevBalance.balance,
        },
        cvChange: status.enCV - prevStatus.enCV,
        balanceChange: clientBalance.balance - prevBalance.balance,
      }
    }

    return {
      totalClientesActivos: status.totalActivos,
      clientesAlCorriente: status.alCorriente,
      clientesEnCV: status.enCV,
      clientBalance,
      comparison,
    }
  }

  /**
   * Calculates summary for monthly reports with CV average from completed weeks
   */
  private async calculateSummaryForMonth(
    loans: LoanForPortfolio[],
    paymentsMap: Map<string, PaymentForCV[]>,
    lastCompletedWeek: WeekRange | null,
    previousWeek: WeekRange | null,
    periodStart: Date,
    periodEnd: Date,
    previousPeriodStart: Date | null,
    previousPeriodEnd: Date | null,
    promedioCV: number,
    semanasCompletadas: number,
    totalSemanas: number
  ): Promise<PortfolioSummary> {
    // Calculate client balance for the period
    const clientBalance = calculateClientBalance(loans, periodStart, periodEnd)

    // Get status from last completed week (if any)
    let status = { totalActivos: 0, alCorriente: 0, enCV: 0 }
    if (lastCompletedWeek) {
      status = countClientsStatus(loans, paymentsMap, lastCompletedWeek)
    } else {
      // If no completed weeks, just count active loans without CV
      status = {
        totalActivos: loans.length,
        alCorriente: loans.length, // All are "al corriente" since we can't calculate CV yet
        enCV: 0,
      }
    }

    // Calculate comparison with previous period
    let comparison = null
    if (previousPeriodStart && previousPeriodEnd && previousWeek) {
      const { loans: prevLoans, paymentsMap: prevPaymentsMap } =
        await this.getActiveLoansWithPayments(previousWeek)
      const prevStatus = countClientsStatus(
        prevLoans,
        prevPaymentsMap,
        previousWeek
      )
      const prevBalance = calculateClientBalance(
        prevLoans,
        previousPeriodStart,
        previousPeriodEnd
      )

      comparison = {
        previousPeriod: {
          clientesActivos: prevStatus.totalActivos,
          clientesEnCV: prevStatus.enCV,
          balance: prevBalance.balance,
        },
        cvChange: promedioCV - prevStatus.enCV,
        balanceChange: clientBalance.balance - prevBalance.balance,
      }
    }

    return {
      totalClientesActivos: status.totalActivos,
      clientesAlCorriente: status.alCorriente,
      clientesEnCV: promedioCV, // Use average CV from completed weeks
      promedioCV,
      semanasCompletadas,
      totalSemanas,
      clientBalance,
      comparison,
    }
  }

  private async getRouteBreakdown(
    loans: LoanForPortfolio[],
    paymentsMap: Map<string, PaymentForCV[]>,
    activeWeek: WeekRange,
    filters?: PortfolioFilters
  ): Promise<LocationBreakdown[]> {
    const loanIds = loans.map((l) => l.id)

    const dbLoans = await this.prisma.loan.findMany({
      where: { id: { in: loanIds } },
      include: {
        snapshotRoute: true,
        leadRelation: {
          include: {
            routes: true,
          },
        },
      },
    })

    // Group loans by route
    const loansByRoute = new Map<
      string,
      { loans: LoanForPortfolio[]; routeName: string }
    >()

    for (const dbLoan of dbLoans) {
      const leadRoutes = dbLoan.leadRelation?.routes || []
      const leadRoute = leadRoutes.length > 0 ? leadRoutes[0] : null

      // Route priority: snapshotRouteId > lead's route > 'unknown'
      const routeId = dbLoan.snapshotRouteId || leadRoute?.id || 'unknown'
      const loan = loans.find((l) => l.id === dbLoan.id)
      if (!loan) continue

      if (!loansByRoute.has(routeId)) {
        // Route name priority: snapshotRoute.name > leadRoute.name > snapshotRouteName > 'Sin ruta'
        const routeName =
          dbLoan.snapshotRoute?.name ||
          leadRoute?.name ||
          dbLoan.snapshotRouteName ||
          'Sin ruta'

        loansByRoute.set(routeId, { loans: [], routeName })
      }
      loansByRoute.get(routeId)!.loans.push(loan)
    }

    const result: LocationBreakdown[] = []

    for (const [routeId, data] of loansByRoute) {
      const routePaymentsMap = new Map<string, PaymentForCV[]>()
      for (const loan of data.loans) {
        routePaymentsMap.set(loan.id, paymentsMap.get(loan.id) || [])
      }

      const status = countClientsStatus(
        data.loans,
        routePaymentsMap,
        activeWeek
      )
      const balance = calculateClientBalance(
        data.loans,
        activeWeek.start,
        activeWeek.end
      )

      result.push({
        locationId: routeId,
        locationName: data.routeName,
        routeId: routeId,
        routeName: data.routeName,
        clientesActivos: status.totalActivos,
        clientesAlCorriente: status.alCorriente,
        clientesEnCV: status.enCV,
        balance: balance.balance,
      })
    }

    return result.sort((a, b) => b.clientesActivos - a.clientesActivos)
  }

  private async getRenovationKPIs(
    periodStart: Date,
    periodEnd: Date,
    filters?: PortfolioFilters
  ): Promise<RenovationKPIs> {
    const whereClause: any = {}

    if (filters?.routeIds?.length) {
      whereClause.snapshotRouteId = { in: filters.routeIds }
    }
    if (filters?.loantypeIds?.length) {
      whereClause.loantype = { in: filters.loantypeIds }
    }

    const loans = await this.prisma.loan.findMany({
      where: {
        ...whereClause,
        OR: [
          // Loans with renewedDate in period
          {
            renewedDate: {
              gte: periodStart,
              lte: periodEnd,
            },
          },
          // Loans that finished in period without renewal
          {
            finishedDate: {
              gte: periodStart,
              lte: periodEnd,
            },
            renewedDate: null,
            status: { not: 'RENOVATED' },
          },
          // Fallback: Loans with status RENOVATED but no renewedDate (use finishedDate)
          {
            finishedDate: {
              gte: periodStart,
              lte: periodEnd,
            },
            renewedDate: null,
            status: 'RENOVATED',
          },
        ],
      },
    })

    const portfolioLoans = loans.map((loan) => this.toLoanForPortfolio(loan))
    return calculateRenovationKPIs(portfolioLoans, periodStart, periodEnd)
  }
}
