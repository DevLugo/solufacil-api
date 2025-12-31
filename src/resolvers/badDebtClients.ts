import type { GraphQLContext } from '@solufacil/graphql-schema'
import { BadDebtClientsService } from '../services/BadDebtClientsService'
import { authenticateUser } from '../middleware/auth'

export const badDebtClientsResolvers = {
  Query: {
    badDebtClients: async (
      _parent: unknown,
      args: {
        routeId?: string
        locationId?: string
        limit?: number
        offset?: number
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const badDebtClientsService = new BadDebtClientsService(context.prisma)
      return badDebtClientsService.getBadDebtClients({
        routeId: args.routeId,
        locationId: args.locationId,
        limit: args.limit,
        offset: args.offset,
      })
    },
  },
}
