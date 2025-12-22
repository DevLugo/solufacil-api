import type { GraphQLContext } from '@solufacil/graphql-schema'
import type { TransactionType } from '@solufacil/database'
import { TransactionService } from '../services/TransactionService'
import { authenticateUser } from '../middleware/auth'

export const transactionResolvers = {
  Query: {
    transactions: async (
      _parent: unknown,
      args: {
        type?: TransactionType
        routeId?: string
        accountId?: string
        fromDate?: Date
        toDate?: Date
        limit?: number
        offset?: number
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const transactionService = new TransactionService(context.prisma)
      const { transactions, totalCount } = await transactionService.findMany({
        type: args.type ?? undefined,
        routeId: args.routeId ?? undefined,
        accountId: args.accountId ?? undefined,
        fromDate: args.fromDate ?? undefined,
        toDate: args.toDate ?? undefined,
        limit: args.limit ?? undefined,
        offset: args.offset ?? undefined,
      })

      // Format as connection type
      const edges = transactions.map((transaction, index) => ({
        node: transaction,
        cursor: Buffer.from(`cursor:${(args.offset ?? 0) + index}`).toString('base64'),
      }))

      return {
        edges,
        totalCount,
        pageInfo: {
          hasNextPage: (args.offset ?? 0) + transactions.length < totalCount,
          hasPreviousPage: (args.offset ?? 0) > 0,
          startCursor: edges[0]?.cursor || null,
          endCursor: edges[edges.length - 1]?.cursor || null,
        },
      }
    },
  },

  Mutation: {
    createTransaction: async (
      _parent: unknown,
      args: {
        input: {
          amount: string
          date: Date
          type: TransactionType
          incomeSource?: string
          expenseSource?: string
          sourceAccountId?: string
          destinationAccountId?: string
          loanId?: string
          loanPaymentId?: string
          routeId?: string
          leadId?: string
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const transactionService = new TransactionService(context.prisma)
      return transactionService.create(args.input)
    },

    updateTransaction: async (
      _parent: unknown,
      args: {
        id: string
        input: {
          amount?: string
          expenseSource?: string
          incomeSource?: string
          sourceAccountId?: string
          description?: string
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const transactionService = new TransactionService(context.prisma)
      return transactionService.update(args.id, args.input)
    },

    deleteTransaction: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const transactionService = new TransactionService(context.prisma)
      return transactionService.delete(args.id)
    },

    transferBetweenAccounts: async (
      _parent: unknown,
      args: {
        input: {
          amount: string
          sourceAccountId: string
          destinationAccountId: string
          description?: string
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const transactionService = new TransactionService(context.prisma)
      return transactionService.transferBetweenAccounts(args.input)
    },
  },

  Transaction: {
    loan: async (
      parent: { loan?: string; loanRelation?: unknown },
      _args: unknown,
      context: GraphQLContext
    ) => {
      // If loanRelation is already included, return it
      if (parent.loanRelation) {
        return parent.loanRelation
      }
      if (!parent.loan) return null
      return context.prisma.loan.findUnique({
        where: { id: parent.loan },
      })
    },

    loanPayment: async (
      parent: { loanPayment?: string; loanPaymentRelation?: unknown },
      _args: unknown,
      context: GraphQLContext
    ) => {
      // If loanPaymentRelation is already included, return it
      if (parent.loanPaymentRelation) {
        return parent.loanPaymentRelation
      }
      if (!parent.loanPayment) return null
      return context.prisma.loanPayment.findUnique({
        where: { id: parent.loanPayment },
      })
    },

    sourceAccount: async (
      parent: { sourceAccount?: string; sourceAccountRelation?: unknown },
      _args: unknown,
      context: GraphQLContext
    ) => {
      // If sourceAccountRelation is already included, return it
      if (parent.sourceAccountRelation) {
        return parent.sourceAccountRelation
      }
      // Check for null/undefined/empty string
      if (!parent.sourceAccount) return null
      return context.prisma.account.findUnique({
        where: { id: parent.sourceAccount },
      })
    },

    destinationAccount: async (
      parent: { destinationAccount?: string; destinationAccountRelation?: unknown },
      _args: unknown,
      context: GraphQLContext
    ) => {
      // If destinationAccountRelation is already included, return it
      if (parent.destinationAccountRelation) {
        return parent.destinationAccountRelation
      }
      if (!parent.destinationAccount) return null
      return context.prisma.account.findUnique({
        where: { id: parent.destinationAccount },
      })
    },

    route: async (
      parent: { route?: string; routeRelation?: unknown },
      _args: unknown,
      context: GraphQLContext
    ) => {
      // If routeRelation is already included, return it
      if (parent.routeRelation) {
        return parent.routeRelation
      }
      if (!parent.route) return null
      return context.prisma.route.findUnique({
        where: { id: parent.route },
      })
    },

    lead: async (
      parent: { lead?: string; leadRelation?: unknown },
      _args: unknown,
      context: GraphQLContext
    ) => {
      // If leadRelation is already included, return it
      if (parent.leadRelation) {
        return parent.leadRelation
      }
      if (!parent.lead) return null
      return context.prisma.employee.findUnique({
        where: { id: parent.lead },
        include: {
          personalDataRelation: true,
        },
      })
    },
  },
}
