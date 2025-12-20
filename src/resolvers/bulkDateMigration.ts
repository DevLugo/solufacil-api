import type { GraphQLContext } from '@solufacil/graphql-schema'
import { BulkDateMigrationService } from '../services/BulkDateMigrationService'
import { authenticateUser } from '../middleware/auth'

export interface BulkDateMigrationInput {
  startCreatedAt: Date
  endCreatedAt: Date
  newBusinessDate: Date
}

export const bulkDateMigrationResolvers = {
  Query: {
    previewBulkDateMigration: async (
      _parent: unknown,
      args: { input: BulkDateMigrationInput },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new BulkDateMigrationService(context.prisma)
      return service.previewMigration(args.input)
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
      return service.executeMigration(args.input)
    },
  },
}
