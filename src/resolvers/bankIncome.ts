import type { GraphQLContext } from '@solufacil/graphql-schema'
import { UserRole } from '@solufacil/database'
import { toDecimal } from '@solufacil/shared'
import { authenticateUser, requireRole } from '../middleware/auth'

export const bankIncomeResolvers = {
  Query: {
    getBankIncomeTransactions: async (
      _parent: unknown,
      args: {
        startDate: string
        endDate: string
        routeIds: string[]
        onlyAbonos?: boolean
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, [UserRole.ADMIN])

      try {
        const { startDate, endDate, routeIds, onlyAbonos = false } = args

        // Get bank account IDs
        const bankAccounts = await context.prisma.account.findMany({
          where: { type: 'BANK' },
          select: { id: true },
        })
        const bankAccountIds = bankAccounts.map((a) => a.id)

        // Build where conditions for AccountEntry
        const whereConditions: any = {
          entryDate: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        }

        // Filter by entry type
        if (onlyAbonos) {
          // Only client payments to bank - filtered by loan's lead routes
          whereConditions.sourceType = 'LOAN_PAYMENT_BANK'
          whereConditions.entryType = 'CREDIT'
          whereConditions.loan = {
            leadRelation: {
              routes: {
                some: { id: { in: routeIds } },
              },
            },
          }
        } else {
          // Bank payments and transfers to bank
          // Each entry type filtered by its appropriate route relation
          whereConditions.OR = [
            // Direct bank payments from clients - filtered by loan's lead routes
            {
              sourceType: 'LOAN_PAYMENT_BANK',
              entryType: 'CREDIT',
              loan: {
                leadRelation: {
                  routes: {
                    some: { id: { in: routeIds } },
                  },
                },
              },
            },
            // Leader deposits to bank - filtered by LeadPaymentReceived's lead routes
            {
              sourceType: 'TRANSFER_IN',
              accountId: { in: bankAccountIds },
              leadPaymentReceived: {
                leadRelation: {
                  routes: {
                    some: { id: { in: routeIds } },
                  },
                },
              },
            },
          ]
        }

        const entries = await context.prisma.accountEntry.findMany({
          where: whereConditions,
          include: {
            account: true,
            loanPayment: {
              include: {
                loanRelation: {
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
                              include: {
                                locationRelation: true,
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
            leadPaymentReceived: {
              include: {
                leadRelation: {
                  include: {
                    personalDataRelation: {
                      include: {
                        addresses: {
                          include: {
                            locationRelation: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { entryDate: 'desc' },
        })

        // Get leader info for entries with snapshotLeadId
        const leaderIds = [...new Set(entries.map((e) => e.snapshotLeadId).filter(Boolean))]
        const leaders =
          leaderIds.length > 0
            ? await context.prisma.employee.findMany({
                where: { id: { in: leaderIds } },
                include: {
                  personalDataRelation: {
                    include: {
                      addresses: {
                        include: {
                          locationRelation: true,
                        },
                      },
                    },
                  },
                },
              })
            : []
        const leaderMap = new Map(leaders.map((l) => [l.id, l]))

        const processedTransactions = entries.map((entry) => {
          const isClientPayment = entry.sourceType === 'LOAN_PAYMENT_BANK'
          const isLeaderPayment = entry.sourceType === 'TRANSFER_IN' && bankAccountIds.includes(entry.accountId)

          // Get leader from snapshotLeadId, leadPaymentReceived relation, or loan relation
          const leader =
            leaderMap.get(entry.snapshotLeadId) ||
            entry.leadPaymentReceived?.leadRelation ||
            entry.loanPayment?.loanRelation?.leadRelation

          const employeeName = leader?.personalDataRelation?.fullName
          const leaderLocality = leader?.personalDataRelation?.addresses?.[0]?.locationRelation?.name

          const clientName =
            entry.loanPayment?.loanRelation?.borrowerRelation?.personalDataRelation?.fullName

          // Map entry to transaction-like response for backwards compatibility
          const transactionType = isClientPayment
            ? 'INCOME'
            : isLeaderPayment
            ? 'TRANSFER'
            : 'INCOME'

          const incomeSource = isClientPayment ? 'BANK_LOAN_PAYMENT' : null

          return {
            id: entry.id,
            amount: toDecimal(entry.amount),
            type: transactionType,
            incomeSource,
            date: entry.entryDate?.toISOString() || new Date().toISOString(),
            description: entry.description,
            locality: leaderLocality || null,
            employeeName: employeeName || null,
            leaderLocality: leaderLocality || null,
            isClientPayment,
            isLeaderPayment,
            name: isClientPayment
              ? clientName || 'No name'
              : employeeName || 'No name',
          }
        })

        return {
          success: true,
          message: null,
          transactions: processedTransactions,
        }
      } catch (error) {
        console.error('Error getting bank income transactions:', error)
        return {
          success: false,
          message: 'Error fetching bank income transactions',
          transactions: [],
        }
      }
    },
  },
}
