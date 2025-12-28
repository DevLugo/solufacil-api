import type { GraphQLContext } from '@solufacil/graphql-schema'
import type { AccountType } from '@solufacil/database'
import { AccountService } from '../services/AccountService'
import { authenticateUser, requireRole } from '../middleware/auth'

export const accountResolvers = {
  Query: {
    account: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const accountService = new AccountService(context.prisma)
      return accountService.findById(args.id)
    },

    accounts: async (
      _parent: unknown,
      args: { routeId?: string; type?: AccountType },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const accountService = new AccountService(context.prisma)
      return accountService.findMany({
        routeId: args.routeId ?? undefined,
        type: args.type ?? undefined,
      })
    },
  },

  Mutation: {
    createAccount: async (
      _parent: unknown,
      args: {
        input: {
          name: string
          type: AccountType
          amount: string
          routeIds?: string[]
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, ['ADMIN'])

      const accountService = new AccountService(context.prisma)
      return accountService.create(args.input)
    },

    updateAccount: async (
      _parent: unknown,
      args: {
        id: string
        input: {
          name?: string
          isActive?: boolean
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, ['ADMIN'])

      const accountService = new AccountService(context.prisma)
      return accountService.update(args.id, args.input)
    },
  },

  Account: {
    routes: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      const account = await context.prisma.account.findUnique({
        where: { id: parent.id },
        include: { routes: true },
      })
      return account?.routes || []
    },

    transactionsSource: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.transaction.findMany({
        where: { sourceAccount: parent.id },
        orderBy: { date: 'desc' },
        take: 50,
      })
    },

    transactionsDestination: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.transaction.findMany({
        where: { destinationAccount: parent.id },
        orderBy: { date: 'desc' },
        take: 50,
      })
    },

    accountBalance: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      const accountService = new AccountService(context.prisma)
      const balance = await accountService.getAccountBalance(parent.id)
      return balance.toString()
    },

    entries: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.accountEntry.findMany({
        where: { accountId: parent.id },
        orderBy: { entryDate: 'desc' },
        take: 50,
      })
    },
  },
}
