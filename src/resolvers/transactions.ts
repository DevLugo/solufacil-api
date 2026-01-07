import type { GraphQLContext } from '@solufacil/graphql-schema'
import type { TransactionType, SourceType, AccountEntryType } from '@solufacil/database'
import { TransactionService } from '../services/TransactionService'
import { TransactionSummaryService } from '../services/TransactionSummaryService'
import { authenticateUser } from '../middleware/auth'

export const transactionResolvers = {
  Query: {
    accountEntries: async (
      _parent: unknown,
      args: {
        accountId?: string
        routeId?: string
        sourceType?: SourceType
        sourceTypes?: SourceType[]
        entryType?: AccountEntryType
        fromDate?: Date
        toDate?: Date
        limit?: number
        offset?: number
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const where: any = {}

      if (args.accountId) {
        where.accountId = args.accountId
      }
      if (args.routeId) {
        // Filter by loan's lead current routes
        where.loan = {
          leadRelation: {
            routes: {
              some: { id: args.routeId },
            },
          },
        }
      }
      if (args.sourceTypes && args.sourceTypes.length > 0) {
        where.sourceType = { in: args.sourceTypes }
      } else if (args.sourceType) {
        where.sourceType = args.sourceType
      }
      if (args.entryType) {
        where.entryType = args.entryType
      }
      if (args.fromDate || args.toDate) {
        where.entryDate = {}
        if (args.fromDate) {
          where.entryDate.gte = args.fromDate
        }
        if (args.toDate) {
          where.entryDate.lte = args.toDate
        }
      }

      const limit = args.limit ?? 50
      const offset = args.offset ?? 0

      const [entries, totalCount] = await Promise.all([
        context.prisma.accountEntry.findMany({
          where,
          include: {
            account: true,
            loan: true,
            loanPayment: true,
          },
          orderBy: { entryDate: 'desc' },
          take: limit,
          skip: offset,
        }),
        context.prisma.accountEntry.count({ where }),
      ])

      // Format as connection type
      const edges = entries.map((entry, index) => ({
        node: entry,
        cursor: Buffer.from(`cursor:${offset + index}`).toString('base64'),
      }))

      return {
        edges,
        totalCount,
        pageInfo: {
          hasNextPage: offset + entries.length < totalCount,
          hasPreviousPage: offset > 0,
          startCursor: edges[0]?.cursor || null,
          endCursor: edges[edges.length - 1]?.cursor || null,
        },
      }
    },

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

    transactionsSummaryByLocation: async (
      _parent: unknown,
      args: {
        routeId: string
        startDate: Date
        endDate: Date
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const summaryService = new TransactionSummaryService(context.prisma)
      const result = await summaryService.getSummaryByLocation(
        args.routeId,
        args.startDate,
        args.endDate
      )

      // Convert Decimal to string for GraphQL
      return {
        localities: result.localities.map((loc) => ({
          ...loc,
          totalPayments: loc.totalPayments.toString(),
          cashPayments: loc.cashPayments.toString(),
          bankPayments: loc.bankPayments.toString(),
          totalPaymentCommissions: loc.totalPaymentCommissions.toString(),
          totalLoansGrantedCommissions: loc.totalLoansGrantedCommissions.toString(),
          totalCommissions: loc.totalCommissions.toString(),
          totalExpenses: loc.totalExpenses.toString(),
          totalLoansGranted: loc.totalLoansGranted.toString(),
          balanceEfectivo: loc.balanceEfectivo.toString(),
          balanceBanco: loc.balanceBanco.toString(),
          balance: loc.balance.toString(),
          payments: loc.payments.map((p) => ({
            ...p,
            amount: p.amount.toString(),
            commission: p.commission.toString(),
          })),
          expenses: loc.expenses.map((e) => ({
            ...e,
            amount: e.amount.toString(),
          })),
          loansGranted: loc.loansGranted.map((l) => ({
            ...l,
            amount: l.amount.toString(),
          })),
        })),
        executiveSummary: {
          ...result.executiveSummary,
          totalPaymentsReceived: result.executiveSummary.totalPaymentsReceived.toString(),
          totalCashPayments: result.executiveSummary.totalCashPayments.toString(),
          totalBankPayments: result.executiveSummary.totalBankPayments.toString(),
          totalPaymentCommissions: result.executiveSummary.totalPaymentCommissions.toString(),
          totalLoansGrantedCommissions: result.executiveSummary.totalLoansGrantedCommissions.toString(),
          totalCommissions: result.executiveSummary.totalCommissions.toString(),
          totalExpenses: result.executiveSummary.totalExpenses.toString(),
          totalLoansGranted: result.executiveSummary.totalLoansGranted.toString(),
          netBalance: result.executiveSummary.netBalance.toString(),
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
          description?: string
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

  AccountEntry: {
    account: async (
      parent: { accountId: string; account?: unknown },
      _args: unknown,
      context: GraphQLContext
    ) => {
      if (parent.account) {
        return parent.account
      }
      return context.prisma.account.findUnique({
        where: { id: parent.accountId },
      })
    },

    loan: async (
      parent: { loanId?: string | null; loan?: unknown },
      _args: unknown,
      context: GraphQLContext
    ) => {
      if (parent.loan) {
        return parent.loan
      }
      if (!parent.loanId) return null
      return context.prisma.loan.findUnique({
        where: { id: parent.loanId },
      })
    },

    loanPayment: async (
      parent: { loanPaymentId?: string | null; loanPayment?: unknown },
      _args: unknown,
      context: GraphQLContext
    ) => {
      if (parent.loanPayment) {
        return parent.loanPayment
      }
      if (!parent.loanPaymentId) return null
      return context.prisma.loanPayment.findUnique({
        where: { id: parent.loanPaymentId },
      })
    },

    destinationAccount: async (
      parent: { destinationAccountId?: string | null },
      _args: unknown,
      context: GraphQLContext
    ) => {
      if (!parent.destinationAccountId) return null
      return context.prisma.account.findUnique({
        where: { id: parent.destinationAccountId },
      })
    },

    route: async (
      parent: { snapshotLeadId?: string | null },
      _args: unknown,
      context: GraphQLContext
    ) => {
      // Get route from lead's current routes
      if (!parent.snapshotLeadId) return null
      const lead = await context.prisma.employee.findUnique({
        where: { id: parent.snapshotLeadId },
        select: { routes: { take: 1 } },
      })
      return lead?.routes?.[0] || null
    },

    lead: async (
      parent: { snapshotLeadId?: string | null },
      _args: unknown,
      context: GraphQLContext
    ) => {
      if (!parent.snapshotLeadId) return null
      return context.prisma.employee.findUnique({
        where: { id: parent.snapshotLeadId },
        include: {
          personalDataRelation: true,
        },
      })
    },
  },
}
