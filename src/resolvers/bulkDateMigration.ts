import type { GraphQLContext, BulkDateMigrationInput } from '@solufacil/graphql-schema'
import { BulkDateMigrationService } from '../services/BulkDateMigrationService'
import { authenticateUser } from '../middleware/auth'

export const bulkDateMigrationResolvers = {
  Query: {
    previewBulkDateMigration: async (
      _parent: unknown,
      args: { input: BulkDateMigrationInput },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new BulkDateMigrationService(context.prisma)
      return service.previewMigration({
        startBusinessDate: new Date(args.input.startBusinessDate),
        endBusinessDate: new Date(args.input.endBusinessDate),
        newBusinessDate: new Date(args.input.newBusinessDate),
        routeId: args.input.routeId ?? undefined,
      })
    },
  },

  Mutation: {
    executeBulkDateMigration: async (
      _parent: unknown,
      args: { input: BulkDateMigrationInput },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new BulkDateMigrationService(context.prisma)
      return service.executeMigration({
        startBusinessDate: new Date(args.input.startBusinessDate),
        endBusinessDate: new Date(args.input.endBusinessDate),
        newBusinessDate: new Date(args.input.newBusinessDate),
        routeId: args.input.routeId ?? undefined,
      })
    },
  },
}
