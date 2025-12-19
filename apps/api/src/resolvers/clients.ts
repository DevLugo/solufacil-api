import type { GraphQLContext } from '@solufacil/graphql-schema'
import { ClientHistoryService } from '../services/ClientHistoryService'
import { authenticateUser } from '../middleware/auth'
import { USER_ROLES } from '@solufacil/shared'

export const clientResolvers = {
  Query: {
    searchClients: async (
      _parent: unknown,
      args: {
        searchTerm: string
        routeId?: string
        locationId?: string
        limit?: number
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      const isAdmin = context.user?.role === USER_ROLES.ADMIN

      const clientHistoryService = new ClientHistoryService(context.prisma)
      return clientHistoryService.searchClients(
        {
          searchTerm: args.searchTerm,
          routeId: args.routeId,
          locationId: args.locationId,
          limit: args.limit,
        },
        { isAdmin }
      )
    },

    getClientHistory: async (
      _parent: unknown,
      args: {
        clientId: string
        routeId?: string
        locationId?: string
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      const isAdmin = context.user?.role === USER_ROLES.ADMIN

      const clientHistoryService = new ClientHistoryService(context.prisma)
      return clientHistoryService.getClientHistory(
        args.clientId,
        args.routeId,
        args.locationId,
        { isAdmin }
      )
    },
  },
}
