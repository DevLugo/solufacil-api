import type { ExtendedPrismaClient } from '@solufacil/database'

export interface BadDebtClientItem {
  id: string
  loanId: string
  clientName: string
  clientCode: string | null
  clientPhone: string | null
  amountRequested: string
  totalAmountDue: string
  totalPaid: string
  pendingDebt: string
  locationName: string | null
  municipalityName: string | null
  routeName: string | null
  leadName: string | null
  leadPhone: string | null
  signDate: Date
  badDebtDate: Date | null
  cleanupDate: Date | null
  lastPaymentDate: Date | null
  isFromCleanup: boolean
  borrowerPersonalDataId: string
}

export interface BadDebtClientsResult {
  clients: BadDebtClientItem[]
  totalCount: number
  hasMore: boolean
}

export interface BadDebtClientsInput {
  routeId?: string
  locationId?: string
  limit?: number
  offset?: number
}

// Shared include for loan queries with relations
const LOAN_INCLUDE = {
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
                  routeRelation: true,
                },
              },
            },
          },
        },
      },
    },
  },
  leadRelation: {
    include: {
      personalDataRelation: {
        include: {
          phones: true,
          addresses: {
            include: {
              locationRelation: {
                include: {
                  municipalityRelation: true,
                  routeRelation: true,
                },
              },
            },
          },
        },
      },
    },
  },
  loantypeRelation: true,
  payments: {
    orderBy: { receivedAt: 'desc' as const },
    take: 1,
  },
  excludedByCleanupRelation: true,
  snapshotRoute: true,
}

export class BadDebtClientsService {
  constructor(private prisma: ExtendedPrismaClient) {}

  async getBadDebtClients(
    input: BadDebtClientsInput
  ): Promise<BadDebtClientsResult> {
    const { routeId, locationId, limit = 20, offset = 0 } = input

    // Build the where clause
    const whereClause: any = {
      status: 'ACTIVE',
      OR: [
        { badDebtDate: { not: null } },
        { excludedByCleanup: { not: null } },
      ],
    }

    // Filter by route if provided
    if (routeId) {
      whereClause.snapshotRouteId = routeId
    }

    // Filter by location if provided
    if (locationId) {
      whereClause.leadRelation = {
        personalDataRelation: {
          addresses: {
            some: {
              location: locationId,
            },
          },
        },
      }
    }

    // Get total count for pagination
    const totalCount = await this.prisma.loan.count({
      where: whereClause,
    })

    // Fetch the loans with all necessary relations
    const loans = await this.prisma.loan.findMany({
      where: whereClause,
      include: LOAN_INCLUDE,
      orderBy: [
        { badDebtDate: { sort: 'desc', nulls: 'last' } },
        { signDate: 'desc' },
      ],
      skip: offset,
      take: limit,
    })

    // Transform the loans into BadDebtClientItem format
    const clients: BadDebtClientItem[] = loans.map((loan: any) => {
      const borrower = loan.borrowerRelation
      const personalData = borrower?.personalDataRelation
      const leadPersonalData = loan.leadRelation?.personalDataRelation
      const leadAddress = leadPersonalData?.addresses?.[0]
      const leadLocation = leadAddress?.locationRelation

      // Get the primary phone
      const primaryPhone = personalData?.phones?.[0]?.number || null

      // Get location from lead's assignment
      const locationName = leadLocation?.name || null
      const municipalityName = leadLocation?.municipalityRelation?.name || null
      const routeName = loan.snapshotRoute?.name || leadLocation?.routeRelation?.name || null

      // Get lead phone
      const leadPhone = leadPersonalData?.phones?.[0]?.number || null

      // Calculate amounts
      const requestedAmount = parseFloat(loan.requestedAmount?.toString() || '0')
      const rate = parseFloat(loan.loantypeRelation?.rate?.toString() || '0')
      const totalAmountDue = requestedAmount * (1 + rate)

      // Get total paid from payments or stored value
      const totalPaid = parseFloat(loan.totalPaid?.toString() || '0')
      const pendingDebt = totalAmountDue - totalPaid

      // Get last payment date
      const lastPaymentDate = loan.payments?.[0]?.receivedAt || null

      // Check if it's from cleanup
      const isFromCleanup = !!loan.excludedByCleanup
      const cleanupDate = loan.excludedByCleanupRelation?.cleanupDate || null

      return {
        id: `${loan.id}-${personalData?.id || 'unknown'}`,
        loanId: loan.id,
        clientName: personalData?.fullName || 'Desconocido',
        clientCode: personalData?.clientCode || null,
        clientPhone: primaryPhone,
        amountRequested: requestedAmount.toFixed(2),
        totalAmountDue: totalAmountDue.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        pendingDebt: pendingDebt.toFixed(2),
        locationName,
        municipalityName,
        routeName,
        leadName: leadPersonalData?.fullName || null,
        leadPhone,
        signDate: loan.signDate,
        badDebtDate: loan.badDebtDate,
        cleanupDate,
        lastPaymentDate,
        isFromCleanup,
        borrowerPersonalDataId: personalData?.id || '',
      }
    })

    return {
      clients,
      totalCount,
      hasMore: offset + limit < totalCount,
    }
  }
}
