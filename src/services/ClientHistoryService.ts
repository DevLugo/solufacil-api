import type { ExtendedPrismaClient } from '@solufacil/database'

export interface SearchClientsInput {
  searchTerm: string
  routeId?: string
  locationId?: string
  limit?: number
}

export interface ClientSearchResult {
  id: string
  name: string
  clientCode: string
  phone: string | null
  address: string | null
  route: string | null
  location: string | null
  municipality: string | null
  state: string | null
  latestLoanDate: Date | null
  hasLoans: boolean
  hasBeenCollateral: boolean
  totalLoans: number
  activeLoans: number
  finishedLoans: number
  collateralLoans: number
  pendingDebt: number
}

export interface ClientHistoryData {
  client: {
    id: string
    fullName: string
    clientCode: string
    phones: string[]
    addresses: {
      street: string
      city: string | null
      location: string
      route: string
    }[]
    leader: {
      name: string
      route: string
      location: string
      municipality: string | null
      state: string | null
      phone: string | null
    } | null
    isDeceased: boolean
  }
  summary: {
    totalLoansAsClient: number
    totalLoansAsCollateral: number
    activeLoansAsClient: number
    activeLoansAsCollateral: number
    totalAmountRequestedAsClient: string
    totalAmountPaidAsClient: string
    currentPendingDebtAsClient: string
    hasBeenClient: boolean
    hasBeenCollateral: boolean
  }
  loansAsClient: LoanHistoryDetail[]
  loansAsCollateral: LoanHistoryDetail[]
}

export interface LoanHistoryDetail {
  id: string
  signDate: Date
  signDateFormatted: string
  finishedDate: Date | null
  finishedDateFormatted: string | null
  renewedDate: Date | null
  loanType: string
  amountRequested: string
  totalAmountDue: string
  interestAmount: string
  totalPaid: string
  pendingDebt: string
  daysSinceSign: number
  status: string
  wasRenewed: boolean
  weekDuration: number
  rate: string
  leadName: string | null
  routeName: string | null
  paymentsCount: number
  payments: LoanPaymentDetail[]
  noPaymentPeriods: NoPaymentPeriod[]
  renewedFrom: string | null
  renewedTo: string | null
  avalName: string | null
  avalPhone: string | null
  clientName: string | null
  clientDui: string | null
  isDeceased: boolean
}

export interface LoanPaymentDetail {
  id: string
  amount: string
  receivedAt: Date
  receivedAtFormatted: string
  type: string
  paymentMethod: string
  paymentNumber: number
  balanceBeforePayment: string
  balanceAfterPayment: string
}

export interface NoPaymentPeriod {
  id: string
  startDate: Date
  endDate: Date
  startDateFormatted: string
  endDateFormatted: string
  weekCount: number
}

export interface ClientHistoryOptions {
  /** If true, allows viewing employee/user data (admin only) */
  isAdmin?: boolean
}

export class ClientHistoryService {
  constructor(private prisma: ExtendedPrismaClient) {}

  private formatDate(date: Date): string {
    return date.toLocaleDateString('es-SV', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  async searchClients(
    input: SearchClientsInput,
    options: ClientHistoryOptions = {}
  ): Promise<ClientSearchResult[]> {
    const { searchTerm, routeId, locationId, limit = 20 } = input
    const { isAdmin = false } = options

    if (searchTerm.length < 2) {
      return []
    }

    // Build where clause
    // Search filter is always applied
    const searchFilter = {
      OR: [
        { fullName: { contains: searchTerm, mode: 'insensitive' as const } },
        { clientCode: { contains: searchTerm, mode: 'insensitive' as const } },
      ],
    }

    // Security filters for non-admin users
    const securityFilters = isAdmin
      ? []
      : [
          // Cannot see data of people with User accounts
          {
            OR: [
              { employee: null },
              { employee: { user: null } },
            ],
          },
          // Cannot see clients with loans in "Ruta Ciudad"
          {
            OR: [
              { borrower: null },
              {
                borrower: {
                  OR: [
                    { loans: { none: {} } },
                    {
                      loans: {
                        none: {
                          leadRelation: {
                            routes: {
                              some: { name: { equals: 'CIUDAD', mode: 'insensitive' as const } },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ]

    // Search in PersonalData
    const personalDataResults = await this.prisma.personalData.findMany({
      where: {
        AND: [searchFilter, ...securityFilters],
      } as any, // Type assertion needed due to complex conditional filters
      take: limit * 2,
      include: {
        phones: true,
        addresses: {
          include: {
            locationRelation: {
              include: {
                routeRelation: true,
                municipalityRelation: {
                  include: { stateRelation: true },
                },
              },
            },
          },
        },
        borrower: {
          include: {
            loans: {
              select: {
                id: true,
                status: true,
                signDate: true,
                pendingAmountStored: true,
                // Get lead's location for correct locality display
                leadRelation: {
                  select: {
                    personalDataRelation: {
                      select: {
                        addresses: {
                          select: {
                            location: true,
                            locationRelation: {
                              select: {
                                id: true,
                                name: true,
                                municipalityRelation: {
                                  select: {
                                    name: true,
                                  },
                                },
                              },
                            },
                          },
                          take: 1,
                        },
                      },
                    },
                    routes: {
                      select: {
                        id: true,
                        name: true,
                      },
                      take: 1,
                    },
                  },
                },
              },
              orderBy: { signDate: 'desc' },
            },
          },
        },
      },
    })

    // Filter by route/location if specified
    let filteredResults = personalDataResults
    if (routeId) {
      filteredResults = filteredResults.filter((pd) =>
        pd.addresses.some((addr) => addr.locationRelation?.route === routeId)
      )
    }
    if (locationId) {
      filteredResults = filteredResults.filter((pd) =>
        pd.addresses.some((addr) => addr.location === locationId)
      )
    }

    // Also find loans where this personalData is a collateral
    const collateralLoansMap = new Map<string, number>()
    const personalDataIds = filteredResults.map((pd) => pd.id)

    if (personalDataIds.length > 0) {
      const collateralLoans = await this.prisma.loan.findMany({
        where: {
          collaterals: {
            some: {
              id: { in: personalDataIds },
            },
          },
        },
        select: {
          id: true,
          collaterals: {
            select: { id: true },
          },
        },
      })

      for (const loan of collateralLoans) {
        for (const collateral of loan.collaterals) {
          collateralLoansMap.set(
            collateral.id,
            (collateralLoansMap.get(collateral.id) || 0) + 1
          )
        }
      }
    }

    // Map to result format
    const results: ClientSearchResult[] = filteredResults.map((pd) => {
      const primaryAddress = pd.addresses[0]
      const primaryPhone = pd.phones[0]
      const borrower = pd.borrower
      const loans = borrower?.loans || []
      const activeLoans = loans.filter((l) => l.status === 'ACTIVE')
      const finishedLoans = loans.filter((l) => l.status === 'FINISHED')
      const latestLoan = loans[0]
      const collateralCount = collateralLoansMap.get(pd.id) || 0

      // Calculate pending debt from active loans
      const pendingDebt = activeLoans.reduce((sum, loan) => {
        const pending = parseFloat(String(loan.pendingAmountStored || '0'))
        return sum + (isNaN(pending) ? 0 : pending)
      }, 0)

      // Get route info from most recent loan (prioritize active loans, then any loan)
      const loanForRouteInfo = activeLoans[0] || latestLoan
      // Use lead's location for locality display (not route's first location)
      const leadLocation =
        loanForRouteInfo?.leadRelation?.personalDataRelation?.addresses?.[0]
          ?.locationRelation
      const leadRoute = loanForRouteInfo?.leadRelation?.routes?.[0]

      // Route name: use lead's current route
      const routeName = leadRoute?.name || null
      // Location: from lead's address location
      const locationName = leadLocation?.name || null
      // Municipality: from lead's location's municipality
      const municipalityName = leadLocation?.municipalityRelation?.name || null

      return {
        id: pd.id,
        name: pd.fullName,
        clientCode: pd.clientCode,
        phone: primaryPhone?.number || null,
        address: primaryAddress
          ? `${primaryAddress.street}, ${primaryAddress.locationRelation?.name || ''}`
          : null,
        route: routeName,
        location: locationName,
        municipality: municipalityName,
        state:
          primaryAddress?.locationRelation?.municipalityRelation?.stateRelation
            ?.name || null,
        latestLoanDate: latestLoan?.signDate || null,
        hasLoans: loans.length > 0,
        hasBeenCollateral: collateralCount > 0,
        totalLoans: loans.length,
        activeLoans: activeLoans.length,
        finishedLoans: finishedLoans.length,
        collateralLoans: collateralCount,
        pendingDebt,
      }
    })

    // Sort: clients with loans first, then by name
    results.sort((a, b) => {
      if (a.hasLoans && !b.hasLoans) return -1
      if (!a.hasLoans && b.hasLoans) return 1
      return a.name.localeCompare(b.name)
    })

    return results.slice(0, limit)
  }

  async getLoanHistoryDetail(
    loanId: string
  ): Promise<LoanHistoryDetail | null> {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        loantypeRelation: true,
        leadRelation: {
          include: {
            personalDataRelation: {
              include: {
                phones: true,
              },
            },
          },
        },
        borrowerRelation: {
          include: {
            personalDataRelation: {
              include: { phones: true },
            },
          },
        },
        collaterals: {
          include: { phones: true },
        },
        payments: {
          orderBy: { receivedAt: 'asc' },
        },
        previousLoanRelation: true,
        renewedBy: true,
      },
    })

    if (!loan) {
      return null
    }

    return this.mapLoanToDetail(loan, false, [loan])
  }

  private mapLoanToDetail(
    loan: any,
    isCollateral: boolean,
    allLoans: any[]
  ): LoanHistoryDetail {
    const now = new Date()
    const signDate = new Date(loan.signDate)
    const daysSinceSign = Math.floor(
      (now.getTime() - signDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    const requestedAmount = parseFloat(loan.requestedAmount?.toString() || '0')
    const rate = parseFloat(loan.loantypeRelation?.rate?.toString() || '0')
    const totalAmountDue = requestedAmount * (1 + rate)
    const interestAmount = requestedAmount * rate

    // Calculate balance progression for payments and total paid on the fly
    let runningBalance = totalAmountDue
    let calculatedTotalPaid = 0
    const payments: LoanPaymentDetail[] = loan.payments.map(
      (p: any, idx: number) => {
        const amount = parseFloat(p.amount?.toString() || '0')
        calculatedTotalPaid += amount
        const balanceBefore = runningBalance
        runningBalance -= amount
        const balanceAfter = Math.max(0, runningBalance)

        return {
          id: p.id,
          amount: p.amount,
          receivedAt: p.receivedAt,
          receivedAtFormatted: this.formatDate(new Date(p.receivedAt)),
          type: p.type || 'PAYMENT',
          paymentMethod: p.paymentMethod,
          paymentNumber: idx + 1,
          balanceBeforePayment: balanceBefore.toString(),
          balanceAfterPayment: balanceAfter.toString(),
        }
      }
    )

    const noPaymentPeriods: NoPaymentPeriod[] = []
    const collateral = loan.collaterals?.[0]
    const borrowerData = loan.borrowerRelation?.personalDataRelation
    const wasRenewed = !!loan.renewedDate
    const renewingLoan = loan.renewedBy
      ? loan.renewedBy
      : allLoans.find((l: any) => l.previousLoan === loan.id)

    return {
      id: loan.id,
      signDate: loan.signDate,
      signDateFormatted: this.formatDate(new Date(loan.signDate)),
      finishedDate: loan.finishedDate,
      finishedDateFormatted: loan.finishedDate
        ? this.formatDate(new Date(loan.finishedDate))
        : null,
      renewedDate: loan.renewedDate,
      loanType: loan.loantypeRelation?.name || 'N/A',
      amountRequested: loan.requestedAmount,
      totalAmountDue: totalAmountDue.toString(),
      interestAmount: interestAmount.toString(),
      totalPaid: calculatedTotalPaid.toString(),
      pendingDebt: loan.pendingAmountStored,
      daysSinceSign,
      status: loan.status,
      wasRenewed,
      weekDuration: loan.loantypeRelation?.weekDuration || 0,
      rate: loan.loantypeRelation?.rate || '0',
      leadName:
        loan.snapshotLeadName ||
        loan.leadRelation?.personalDataRelation?.fullName ||
        null,
      routeName: loan.leadRelation?.routes?.[0]?.name || null,
      paymentsCount: payments.length,
      payments,
      noPaymentPeriods,
      renewedFrom: loan.previousLoan || null,
      renewedTo: renewingLoan?.id || null,
      avalName: isCollateral ? null : collateral?.fullName || null,
      avalPhone: isCollateral
        ? null
        : collateral?.phones?.[0]?.number || null,
      clientName: isCollateral ? borrowerData?.fullName || null : null,
      clientDui: isCollateral ? borrowerData?.clientCode || null : null,
      isDeceased: loan.isDeceased || false,
    }
  }

  async getClientHistory(
    clientId: string,
    _routeId?: string,
    _locationId?: string,
    options: ClientHistoryOptions = {}
  ): Promise<ClientHistoryData> {
    const { isAdmin = false } = options

    // Build security filters for non-admin users
    const historySecurityFilters = isAdmin
      ? {}
      : {
          AND: [
            // Cannot see data of people with User accounts
            {
              OR: [
                { employee: null },
                { employee: { user: null } },
              ],
            },
            // Cannot see clients with loans in "Ruta Ciudad"
            {
              OR: [
                { borrower: null },
                {
                  borrower: {
                    OR: [
                      { loans: { none: {} } },
                      {
                        loans: {
                          none: {
                            leadRelation: {
                              routes: {
                                some: { name: { equals: 'CIUDAD', mode: 'insensitive' as const } },
                              },
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }

    // Get PersonalData with all related info
    const personalData = await this.prisma.personalData.findFirst({
      where: {
        id: clientId,
        ...historySecurityFilters,
      } as any, // Type assertion needed due to complex conditional filters
      include: {
        phones: true,
        addresses: {
          include: {
            locationRelation: {
              include: {
                routeRelation: true,
                municipalityRelation: {
                  include: { stateRelation: true },
                },
              },
            },
          },
        },
        borrower: {
          include: {
            loans: {
              include: {
                loantypeRelation: true,
                leadRelation: {
                  include: {
                    personalDataRelation: {
                      include: {
                        phones: true,
                        addresses: {
                          include: {
                            locationRelation: {
                              include: {
                                routeRelation: true,
                                municipalityRelation: {
                                  include: { stateRelation: true },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                collaterals: {
                  include: { phones: true },
                },
                payments: {
                  orderBy: { receivedAt: 'asc' },
                },
                previousLoanRelation: true,
                renewedBy: true,
              },
              orderBy: { signDate: 'desc' },
            },
          },
        },
      },
    })

    if (!personalData) {
      // Check if the client exists but is blocked (for non-admin users)
      if (!isAdmin) {
        const existsButBlocked = await this.prisma.personalData.findFirst({
          where: {
            id: clientId,
            OR: [
              // Has User account
              { employee: { user: { not: null } } },
              // Has loans in "Ruta Ciudad"
              {
                borrower: {
                  loans: {
                    some: {
                      leadRelation: {
                        routes: {
                          some: { name: { equals: 'CIUDAD', mode: 'insensitive' as const } },
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
          select: { id: true },
        })
        if (existsButBlocked) {
          throw new Error('Acceso denegado: Información privada de usuario')
        }
      }
      throw new Error('Cliente no encontrado')
    }

    // Get loans where this person is a collateral
    const loansAsCollateral = await this.prisma.loan.findMany({
      where: {
        collaterals: {
          some: { id: clientId },
        },
      },
      include: {
        loantypeRelation: true,
        leadRelation: {
          include: {
            personalDataRelation: {
              include: {
                phones: true,
              },
            },
          },
        },
        borrowerRelation: {
          include: {
            personalDataRelation: {
              include: { phones: true },
            },
          },
        },
        payments: {
          orderBy: { receivedAt: 'asc' },
        },
        previousLoanRelation: true,
        renewedBy: true,
      },
      orderBy: { signDate: 'desc' },
    })

    // Get leader info from most recent loan
    const loansAsClient = personalData.borrower?.loans || []
    const mostRecentLoan = loansAsClient[0]
    const leadInfo = mostRecentLoan?.leadRelation
    const leadPersonalData = leadInfo?.personalDataRelation
    const leadAddress = leadPersonalData?.addresses?.[0]

    // Build client info (isDeceased is added later after we check all loans)
    const clientInfo = {
      id: personalData.id,
      fullName: personalData.fullName,
      clientCode: personalData.clientCode,
      phones: personalData.phones.map((p) => p.number),
      addresses: personalData.addresses.map((addr) => ({
        street: addr.street,
        city: addr.locationRelation?.municipalityRelation?.name || null,
        location: addr.locationRelation?.name || '',
        route: addr.locationRelation?.routeRelation?.name || '',
      })),
      leader: leadPersonalData
        ? {
            name: leadPersonalData.fullName,
            route: leadAddress?.locationRelation?.routeRelation?.name || '',
            location: leadAddress?.locationRelation?.name || '',
            municipality:
              leadAddress?.locationRelation?.municipalityRelation?.name || null,
            state:
              leadAddress?.locationRelation?.municipalityRelation?.stateRelation
                ?.name || null,
            phone: leadPersonalData.phones[0]?.number || null,
          }
        : null,
      isDeceased: false, // Will be updated after checking loans
    }

    // Calculate summary
    const activeLoansAsClient = loansAsClient.filter(
      (l) => l.status === 'ACTIVE'
    )
    const activeLoansAsCollateral = loansAsCollateral.filter(
      (l) => l.status === 'ACTIVE'
    )

    // Check if any loan has deceased flag (either as client or collateral)
    const isDeceased =
      loansAsClient.some((l) => l.isDeceased) ||
      loansAsCollateral.some((l) => l.isDeceased)

    // Get first loan date (oldest loan)
    const allLoanDates = loansAsClient.map((l) => new Date(l.signDate))
    const firstLoanDate = allLoanDates.length > 0
      ? new Date(Math.min(...allLoanDates.map((d) => d.getTime())))
      : null

    // Calculate average missed payments per loan
    // Analyze week by week: count weeks where no payment was made
    let avgMissedPaymentsPerLoan = 0
    if (loansAsClient.length > 0) {
      const now = new Date()
      const totalMissed = loansAsClient.reduce((sum, loan) => {
        const signDate = new Date(loan.signDate)
        // Use renewedDate if available, otherwise finishedDate, otherwise now
        const endDate = loan.renewedDate
          ? new Date(loan.renewedDate)
          : loan.finishedDate
          ? new Date(loan.finishedDate)
          : now
        const weekDuration = loan.loantypeRelation?.weekDuration || 0
        const payments = loan.payments || []

        // Calculate weeks elapsed (capped at weekDuration)
        const msPerWeek = 7 * 24 * 60 * 60 * 1000
        const weeksElapsed = Math.min(
          Math.floor((endDate.getTime() - signDate.getTime()) / msPerWeek),
          weekDuration
        )

        // Calculate based on amount paid vs expected weekly payment
        // If someone pays double, that covers 2 weeks
        const expectedWeeklyPayment = parseFloat(
          loan.expectedWeeklyPayment?.toString() || '0'
        )
        const totalPaidAmount = payments.reduce(
          (acc: number, p: any) => acc + parseFloat(p.amount?.toString() || '0'),
          0
        )

        // How many weeks are covered by the payments made?
        const weeksCovered =
          expectedWeeklyPayment > 0
            ? Math.floor(totalPaidAmount / expectedWeeklyPayment)
            : payments.length // fallback to count if no expected amount

        const missedWeeks = Math.max(0, weeksElapsed - weeksCovered)

        return sum + missedWeeks
      }, 0)
      avgMissedPaymentsPerLoan = totalMissed / loansAsClient.length
    }

    const summary = {
      totalLoansAsClient: loansAsClient.length,
      totalLoansAsCollateral: loansAsCollateral.length,
      activeLoansAsClient: activeLoansAsClient.length,
      activeLoansAsCollateral: activeLoansAsCollateral.length,
      totalAmountRequestedAsClient: loansAsClient
        .reduce((sum, l) => sum + parseFloat(l.requestedAmount?.toString() || '0'), 0)
        .toString(),
      totalAmountPaidAsClient: loansAsClient
        .reduce((sum, l) => sum + parseFloat(l.totalPaid?.toString() || '0'), 0)
        .toString(),
      currentPendingDebtAsClient: activeLoansAsClient
        .reduce((sum, l) => sum + parseFloat(l.pendingAmountStored?.toString() || '0'), 0)
        .toString(),
      hasBeenClient: loansAsClient.length > 0,
      hasBeenCollateral: loansAsCollateral.length > 0,
      firstLoanDate: firstLoanDate?.toISOString() || null,
      avgMissedPaymentsPerLoan: Math.round(avgMissedPaymentsPerLoan * 10) / 10, // Round to 1 decimal
    }

    // Combine all loans to find renewing loans across both types (for renewedTo field)
    const allLoansCombined = [...loansAsClient, ...loansAsCollateral]

    // Update isDeceased with actual value
    clientInfo.isDeceased = isDeceased

    return {
      client: clientInfo,
      summary,
      loansAsClient: loansAsClient.map((l) =>
        this.mapLoanToDetail(l, false, allLoansCombined)
      ),
      loansAsCollateral: loansAsCollateral.map((l) =>
        this.mapLoanToDetail(l, true, allLoansCombined)
      ),
    }
  }
}
