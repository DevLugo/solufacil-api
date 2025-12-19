import type { GraphQLContext } from '@solufacil/graphql-schema'
import { LoanStatus } from '@solufacil/database'
import { LoanService } from '../services/LoanService'
import { authenticateUser } from '../middleware/auth'
import { getCurrentWeek, getWeekStartDate, getWeekEndDate } from '../utils/weekUtils'

export const loanResolvers = {
  Query: {
    loan: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loanService = new LoanService(context.prisma)
      return loanService.findById(args.id)
    },

    loans: async (
      _parent: unknown,
      args: {
        status?: LoanStatus
        routeId?: string
        leadId?: string
        locationId?: string
        borrowerId?: string
        fromDate?: Date
        toDate?: Date
        limit?: number
        offset?: number
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loanService = new LoanService(context.prisma)
      const { loans, totalCount } = await loanService.findMany({
        status: args.status ?? undefined,
        routeId: args.routeId ?? undefined,
        leadId: args.leadId ?? undefined,
        locationId: args.locationId ?? undefined,
        borrowerId: args.borrowerId ?? undefined,
        fromDate: args.fromDate ?? undefined,
        toDate: args.toDate ?? undefined,
        limit: args.limit ?? undefined,
        offset: args.offset ?? undefined,
      })

      // Format as connection type
      const edges = loans.map((loan, index) => ({
        node: loan,
        cursor: Buffer.from(`cursor:${args.offset ?? 0 + index}`).toString('base64'),
      }))

      return {
        edges,
        totalCount,
        pageInfo: {
          hasNextPage: (args.offset ?? 0) + loans.length < totalCount,
          hasPreviousPage: (args.offset ?? 0) > 0,
          startCursor: edges[0]?.cursor || null,
          endCursor: edges[edges.length - 1]?.cursor || null,
        },
      }
    },

    loansForBadDebt: async (
      _parent: unknown,
      args: { routeId?: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loanService = new LoanService(context.prisma)
      return loanService.findForBadDebt(args.routeId ?? undefined)
    },

    loansByWeekAndLocation: async (
      _parent: unknown,
      args: {
        year: number
        weekNumber: number
        locationId?: string
        limit?: number
        offset?: number
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loanService = new LoanService(context.prisma)
      return loanService.findByWeekAndLocation(args)
    },

    currentWeek: async (
      _parent: unknown,
      _args: unknown,
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const current = getCurrentWeek()
      const startDate = getWeekStartDate(current.year, current.weekNumber)
      const endDate = getWeekEndDate(current.year, current.weekNumber)

      return {
        year: current.year,
        weekNumber: current.weekNumber,
        startDate,
        endDate,
      }
    },
  },

  Mutation: {
    createLoan: async (
      _parent: unknown,
      args: {
        input: {
          requestedAmount: string
          amountGived: string
          signDate: Date
          borrowerId: string
          loantypeId: string
          grantorId: string
          leadId: string
          collateralIds?: string[]
          previousLoanId?: string
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loanService = new LoanService(context.prisma)
      return loanService.create(args.input)
    },

    updateLoan: async (
      _parent: unknown,
      args: {
        id: string
        input: {
          amountGived?: string
          badDebtDate?: Date
          isDeceased?: boolean
          leadId?: string
          status?: LoanStatus
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loanService = new LoanService(context.prisma)
      return loanService.update(args.id, args.input)
    },

    renewLoan: async (
      _parent: unknown,
      args: {
        loanId: string
        input: {
          requestedAmount: string
          amountGived: string
          signDate: Date
          loantypeId: string
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loanService = new LoanService(context.prisma)
      return loanService.renewLoan(args.loanId, args.input)
    },

    markLoanAsBadDebt: async (
      _parent: unknown,
      args: { loanId: string; badDebtDate: Date },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loanService = new LoanService(context.prisma)
      return loanService.markAsBadDebt(args.loanId, args.badDebtDate)
    },

    finishLoan: async (
      _parent: unknown,
      args: { loanId: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loanService = new LoanService(context.prisma)
      return loanService.finishLoan(args.loanId)
    },

    cancelLoan: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loanService = new LoanService(context.prisma)
      return loanService.cancelLoan(args.id)
    },

    createLoansInBatch: async (
      _parent: unknown,
      args: {
        input: {
          loans: {
            tempId: string
            requestedAmount: string
            amountGived: string
            loantypeId: string
            previousLoanId?: string
            borrowerId?: string
            newBorrower?: {
              personalData: {
                fullName: string
                clientCode?: string
                birthDate?: Date
                phones?: { number: string }[]
                addresses?: {
                  street: string
                  numberInterior?: string
                  numberExterior?: string
                  zipCode?: string
                  locationId: string
                }[]
              }
            }
            collateralIds?: string[]
            newCollateral?: {
              fullName: string
              clientCode?: string
              birthDate?: Date
              phones?: { number: string }[]
              addresses?: {
                street: string
                numberInterior?: string
                numberExterior?: string
                zipCode?: string
                locationId: string
              }[]
            }
            firstPayment?: {
              amount: string
              comission?: string
              paymentMethod: 'CASH' | 'MONEY_TRANSFER'
            }
            isFromDifferentLocation?: boolean
          }[]
          sourceAccountId: string
          signDate: Date
          leadId: string
          grantorId: string
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loanService = new LoanService(context.prisma)
      return loanService.createLoansInBatch(args.input)
    },

    updateLoanExtended: async (
      _parent: unknown,
      args: {
        id: string
        input: {
          loantypeId?: string
          requestedAmount?: string
          borrowerName?: string
          borrowerPhone?: string
          collateralIds?: string[]
          newCollateral?: {
            fullName: string
            clientCode?: string
            phones?: { number: string }[]
            addresses?: {
              street: string
              numberInterior?: string
              numberExterior?: string
              zipCode?: string
              locationId: string
            }[]
          }
          collateralPhone?: string
          comissionAmount?: string
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loanService = new LoanService(context.prisma)
      return loanService.updateLoanExtended(args.id, args.input)
    },

    cancelLoanWithAccountRestore: async (
      _parent: unknown,
      args: { id: string; accountId: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loanService = new LoanService(context.prisma)
      return loanService.cancelLoanWithAccountRestore(args.id, args.accountId)
    },
  },

  Borrower: {
    personalData: async (
      parent: { personalData: string; personalDataRelation?: any },
      _args: unknown,
      context: GraphQLContext
    ) => {
      // Si personalDataRelation ya está incluido, asegurar que tenga id
      if (parent.personalDataRelation) {
        const result = parent.personalDataRelation
        // Ensure id is always present
        if (!result.id) {
          console.warn('⚠️ [BACKEND] Borrower.PersonalData missing id, adding it:', {
            parentPersonalDataId: parent.personalData,
            resultKeys: Object.keys(result),
          })
          return {
            ...result,
            id: parent.personalData,
          }
        }
        return result
      }
      // Si no, buscarlo
      return context.prisma.personalData.findUnique({
        where: { id: parent.personalData },
      })
    },
  },

  Loan: {
    borrower: async (
      parent: { borrower: string; borrowerRelation?: unknown },
      _args: unknown,
      context: GraphQLContext
    ) => {
      // Si borrowerRelation ya está incluido, devolverlo
      if (parent.borrowerRelation) {
        return parent.borrowerRelation
      }
      // Si no, buscarlo
      return context.prisma.borrower.findUnique({
        where: { id: parent.borrower },
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
      })
    },

    loantype: async (
      parent: { loantype: string; loantypeRelation?: unknown },
      _args: unknown,
      context: GraphQLContext
    ) => {
      // Si loantypeRelation ya está incluido, devolverlo
      if (parent.loantypeRelation) {
        return parent.loantypeRelation
      }
      return context.prisma.loantype.findUnique({
        where: { id: parent.loantype },
      })
    },

    grantor: async (
      parent: { grantor?: string; grantorRelation?: unknown },
      _args: unknown,
      context: GraphQLContext
    ) => {
      // Si grantorRelation ya está incluido, devolverlo
      if (parent.grantorRelation) {
        return parent.grantorRelation
      }
      if (!parent.grantor) return null
      return context.prisma.employee.findUnique({
        where: { id: parent.grantor },
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
      })
    },

    lead: async (
      parent: { lead?: string; leadRelation?: unknown },
      _args: unknown,
      context: GraphQLContext
    ) => {
      // Si leadRelation ya está incluido, devolverlo
      if (parent.leadRelation) {
        return parent.leadRelation
      }
      if (!parent.lead) return null
      return context.prisma.employee.findUnique({
        where: { id: parent.lead },
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
      })
    },

    collaterals: async (
      parent: { id: string; collaterals?: unknown[] },
      _args: unknown,
      context: GraphQLContext
    ) => {
      // Si collaterals ya está incluido, devolverlo
      if (parent.collaterals) {
        return parent.collaterals
      }
      // Si no, buscarlo
      const loan = await context.prisma.loan.findUnique({
        where: { id: parent.id },
        include: {
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
      })
      return loan?.collaterals || []
    },

    payments: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.loanPayment.findMany({
        where: { loan: parent.id },
        orderBy: { receivedAt: 'desc' },
      })
    },

    transactions: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.transaction.findMany({
        where: { loan: parent.id },
        orderBy: { date: 'desc' },
      })
    },

    documentPhotos: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.documentPhoto.findMany({
        where: { loan: parent.id },
      })
    },

    previousLoan: async (parent: { previousLoan?: string }, _args: unknown, context: GraphQLContext) => {
      if (!parent.previousLoan) return null
      return context.prisma.loan.findUnique({
        where: { id: parent.previousLoan },
      })
    },

    renewedBy: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.loan.findFirst({
        where: { previousLoan: parent.id },
      })
    },
  },
}
