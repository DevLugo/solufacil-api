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

        const whereConditions: any = {
          AND: [
            {
              date: {
                gte: new Date(startDate),
                lte: new Date(endDate),
              },
            },
            {
              route: {
                in: routeIds,
              },
            },
          ],
        }

        // Filter by transaction type
        if (onlyAbonos) {
          whereConditions.AND.push({
            AND: [{ type: 'INCOME' }, { incomeSource: 'BANK_LOAN_PAYMENT' }],
          })
        } else {
          whereConditions.AND.push({
            OR: [
              {
                AND: [
                  { type: 'TRANSFER' },
                  { destinationAccountRelation: { type: 'BANK' } },
                ],
              },
              {
                AND: [
                  { type: 'INCOME' },
                  {
                    OR: [
                      { incomeSource: 'BANK_LOAN_PAYMENT' },
                      { incomeSource: 'MONEY_INVESMENT' },
                    ],
                  },
                ],
              },
            ],
          })
        }

        const transactions = await context.prisma.transaction.findMany({
          where: whereConditions,
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
            loanRelation: {
              include: {
                borrowerRelation: {
                  include: {
                    personalDataRelation: true,
                  },
                },
              },
            },
            destinationAccountRelation: true,
          },
          orderBy: { date: 'desc' },
        })

        const processedTransactions = transactions.map((transaction) => {
          const isClientPayment =
            transaction.type === 'INCOME' &&
            transaction.incomeSource === 'BANK_LOAN_PAYMENT'
          const isLeaderPayment =
            transaction.type === 'TRANSFER' &&
            transaction.destinationAccountRelation?.type === 'BANK'

          const employeeName =
            transaction.leadRelation?.personalDataRelation?.fullName
          const leaderLocality =
            transaction.leadRelation?.personalDataRelation?.addresses?.[0]
              ?.locationRelation?.name

          const clientName =
            transaction.loanRelation?.borrowerRelation?.personalDataRelation
              ?.fullName

          return {
            id: transaction.id,
            amount: toDecimal(transaction.amount),
            type: transaction.type,
            incomeSource: transaction.incomeSource,
            date: transaction.date?.toISOString() || new Date().toISOString(),
            description: transaction.description,
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
