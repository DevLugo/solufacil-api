import type { PrismaClient, Loan, LoanStatus, Prisma } from '@solufacil/database'
import { Decimal } from 'decimal.js'

export class LoanRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.loan.findUnique({
      where: { id },
      include: {
        borrowerRelation: {
          include: {
            personalDataRelation: {
              include: {
                phones: true,
                addresses: {
                  include: {
                    locationRelation: true,
                  },
                },
              },
            },
          },
        },
        loantypeRelation: true,
        grantorRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        leadRelation: {
          include: {
            personalDataRelation: true,
            routes: true,
          },
        },
        collaterals: true,
        payments: {
          orderBy: { receivedAt: 'desc' },
          take: 20,
        },
        previousLoanRelation: true,
        renewedBy: true,
      },
    })
  }

  async findMany(options?: {
    status?: LoanStatus
    routeId?: string
    leadId?: string
    locationId?: string
    borrowerId?: string
    fromDate?: Date
    toDate?: Date
    limit?: number
    offset?: number
  }) {
    const where: Prisma.LoanWhereInput = {}

    // When status is ACTIVE, use the same filters as the original Keystone implementation:
    // - finishedDate: null (not finished)
    // - pendingAmountStored > 0 (has pending payments)
    // - excludedByCleanup: null (not excluded by cleanup)
    if (options?.status === 'ACTIVE') {
      where.finishedDate = null
      where.pendingAmountStored = { gt: 0 }
      where.excludedByCleanup = null
    } else if (options?.status) {
      where.status = options.status
    }

    if (options?.leadId) {
      where.lead = options.leadId
    }

    // Filter by lead's location - finds all active loans in a specific locality
    // The lead's address defines the locality where the loan was granted
    if (options?.locationId) {
      where.leadRelation = {
        personalDataRelation: {
          addresses: {
            some: {
              location: options.locationId,
            },
          },
        },
      }
    }

    if (options?.borrowerId) {
      where.borrower = options.borrowerId
    }

    if (options?.routeId) {
      where.snapshotRouteId = options.routeId
    }

    if (options?.fromDate || options?.toDate) {
      where.signDate = {}
      if (options?.fromDate) {
        where.signDate.gte = options.fromDate
      }
      if (options?.toDate) {
        where.signDate.lte = options.toDate
      }
    }

    // DEBUG: Log query parameters
    console.log('[LoanRepository.findMany] where:', JSON.stringify(where), 'limit:', options?.limit ?? 50)

    const [loans, totalCount] = await Promise.all([
      this.prisma.loan.findMany({
        where,
        take: options?.limit ?? 50,
        skip: options?.offset ?? 0,
        orderBy: [{ signDate: 'asc' }, { id: 'asc' }],
        include: {
          borrowerRelation: {
            include: {
              personalDataRelation: {
                include: {
                  phones: true,
                  addresses: {
                    include: {
                      locationRelation: {
                        include: {
                          municipalityRelation: {
                            include: {
                              stateRelation: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
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
                          municipalityRelation: {
                            include: {
                              stateRelation: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              routes: true,
            },
          },
          collaterals: {
            include: {
              phones: true,
              addresses: {
                include: {
                  locationRelation: {
                    include: {
                      municipalityRelation: {
                        include: {
                          stateRelation: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.loan.count({ where }),
    ])

    // DEBUG: Log result count
    console.log('[LoanRepository.findMany] found:', loans.length, 'total:', totalCount)

    return { loans, totalCount }
  }

  async create(data: {
    requestedAmount: Decimal
    amountGived: Decimal
    signDate: Date
    profitAmount: Decimal
    totalDebtAcquired: Decimal
    expectedWeeklyPayment: Decimal
    pendingAmountStored: Decimal
    borrower: string
    loantype: string
    grantor: string
    lead: string
    collateralIds?: string[]
    previousLoan?: string
    snapshotLeadId?: string
    snapshotLeadAssignedAt?: Date
    snapshotRouteId?: string
    snapshotRouteName?: string
  }) {
    return this.prisma.loan.create({
      data: {
        requestedAmount: data.requestedAmount,
        amountGived: data.amountGived,
        signDate: data.signDate,
        profitAmount: data.profitAmount,
        totalDebtAcquired: data.totalDebtAcquired,
        expectedWeeklyPayment: data.expectedWeeklyPayment,
        totalPaid: new Decimal(0),
        comissionAmount: new Decimal(0),
        pendingAmountStored: data.pendingAmountStored,
        borrower: data.borrower,
        loantype: data.loantype,
        grantor: data.grantor,
        lead: data.lead,
        previousLoan: data.previousLoan,
        snapshotLeadId: data.snapshotLeadId,
        snapshotLeadAssignedAt: data.snapshotLeadAssignedAt,
        snapshotRouteId: data.snapshotRouteId,
        snapshotRouteName: data.snapshotRouteName,
        collaterals: data.collateralIds
          ? { connect: data.collateralIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        borrowerRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        loantypeRelation: true,
        grantorRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        leadRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        collaterals: true,
      },
    })
  }

  async update(
    id: string,
    data: {
      amountGived?: Decimal
      badDebtDate?: Date | null
      isDeceased?: boolean
      lead?: string
      status?: LoanStatus
      totalPaid?: Decimal
      pendingAmountStored?: Decimal
      finishedDate?: Date | null
      renewedDate?: Date | null
      comissionAmount?: Decimal
    }
  ) {
    return this.prisma.loan.update({
      where: { id },
      data,
      include: {
        borrowerRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        loantypeRelation: true,
        leadRelation: {
          include: {
            personalDataRelation: true,
          },
        },
      },
    })
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.prisma.loan.count({
      where: { id },
    })
    return count > 0
  }

  async findActiveByBorrowerId(borrowerId: string) {
    return this.prisma.loan.findFirst({
      where: {
        borrower: borrowerId,
        status: 'ACTIVE',
      },
    })
  }

  async findForBadDebt(routeId?: string) {
    return this.prisma.loan.findMany({
      where: {
        badDebtDate: { not: null },
        ...(routeId ? { snapshotRouteId: routeId } : {}),
      },
      include: {
        borrowerRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        leadRelation: {
          include: {
            personalDataRelation: true,
          },
        },
      },
      orderBy: { badDebtDate: 'desc' },
    })
  }
}
