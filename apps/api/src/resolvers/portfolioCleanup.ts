import type { GraphQLContext } from '../context'
import { PortfolioCleanupService } from '../services/PortfolioCleanupService'
import { authenticateUser } from '../middleware/auth'

export const portfolioCleanupResolvers = {
  Query: {
    previewPortfolioCleanup: async (
      _: unknown,
      args: { maxSignDate: Date; routeId?: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      const service = new PortfolioCleanupService(context.prisma)
      const preview = await service.previewCleanup(args.maxSignDate, args.routeId ?? undefined)

      return {
        totalLoans: preview.totalLoans,
        totalPendingAmount: preview.totalPendingAmount.toString(),
        sampleLoans: preview.sampleLoans.map((loan) => ({
          id: loan.id,
          clientName: loan.clientName,
          clientCode: loan.clientCode,
          signDate: loan.signDate,
          pendingAmount: loan.pendingAmount.toString(),
          routeName: loan.routeName,
        })),
      }
    },

    portfolioCleanups: async (
      _: unknown,
      args: { limit?: number; offset?: number },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      const service = new PortfolioCleanupService(context.prisma)
      const cleanups = await service.findMany({
        limit: args.limit ?? 50,
        offset: args.offset ?? 0,
      })

      return cleanups.map((cleanup) => ({
        id: cleanup.id,
        name: cleanup.name,
        description: cleanup.description,
        cleanupDate: cleanup.cleanupDate,
        toDate: cleanup.toDate,
        excludedLoansCount: cleanup.excludedLoansCount,
        excludedAmount: cleanup.excludedAmount.toString(),
        route: cleanup.routeRelation,
        executedBy: cleanup.executedBy, // Pass the ID for type resolver
        createdAt: cleanup.cleanupDate,
      }))
    },
  },

  Mutation: {
    createPortfolioCleanup: async (
      _: unknown,
      args: {
        input: {
          name: string
          description?: string
          cleanupDate: Date
          maxSignDate: Date
          routeId?: string
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      const service = new PortfolioCleanupService(context.prisma)
      const cleanup = await service.create(
        {
          name: args.input.name,
          description: args.input.description,
          cleanupDate: args.input.cleanupDate,
          maxSignDate: args.input.maxSignDate,
          routeId: args.input.routeId,
        },
        context.user!.id,
        { userId: context.user!.id, userEmail: context.user!.email }
      )

      return {
        id: cleanup.id,
        name: cleanup.name,
        description: cleanup.description,
        cleanupDate: cleanup.cleanupDate,
        toDate: cleanup.toDate,
        excludedLoansCount: cleanup.excludedLoansCount,
        excludedAmount: cleanup.excludedAmount.toString(),
        route: cleanup.routeRelation,
        executedBy: cleanup.executedByRelation,
        createdAt: cleanup.cleanupDate,
      }
    },

    updatePortfolioCleanup: async (
      _: unknown,
      args: {
        id: string
        input: {
          name?: string
          description?: string
          cleanupDate?: Date
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      const service = new PortfolioCleanupService(context.prisma)
      const cleanup = await service.update(
        args.id,
        args.input,
        { userId: context.user!.id, userEmail: context.user!.email }
      )

      return {
        id: cleanup.id,
        name: cleanup.name,
        description: cleanup.description,
        cleanupDate: cleanup.cleanupDate,
        toDate: cleanup.toDate,
        excludedLoansCount: cleanup.excludedLoansCount,
        excludedAmount: cleanup.excludedAmount.toString(),
        route: cleanup.routeRelation,
        executedBy: cleanup.executedBy,
        createdAt: cleanup.cleanupDate,
      }
    },

    deletePortfolioCleanup: async (
      _: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      const service = new PortfolioCleanupService(context.prisma)
      return service.delete(args.id, { userId: context.user!.id, userEmail: context.user!.email })
    },
  },

  PortfolioCleanup: {
    executedBy: async (parent: { executedBy?: string | object }, _args: unknown, context: GraphQLContext) => {
      // If already resolved (object with id), return as is
      if (parent.executedBy && typeof parent.executedBy === 'object') {
        return parent.executedBy
      }
      // If it's a string ID, fetch the user
      if (typeof parent.executedBy === 'string') {
        return context.prisma.user.findUnique({
          where: { id: parent.executedBy },
        })
      }
      return null
    },
  },
}
