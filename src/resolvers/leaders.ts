import type { GraphQLContext } from '@solufacil/graphql-schema'
import { UserRole } from '@solufacil/database'
import { LeaderService } from '../services/LeaderService'
import { authenticateUser, requireAnyRole } from '../middleware/auth'

export const leadersResolvers = {
  Query: {
    checkExistingLeader: async (
      _parent: unknown,
      args: { locationId: string },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN, UserRole.CAPTURA])

      const leaderService = new LeaderService(context.prisma)
      return leaderService.checkExistingLeader(args.locationId)
    },

    leaderBirthdays: async (
      _parent: unknown,
      args: { routeId?: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const leaderService = new LeaderService(context.prisma)
      return leaderService.getLeaderBirthdays(args.routeId)
    },
  },

  Mutation: {
    createNewLeader: async (
      _parent: unknown,
      args: {
        input: {
          fullName: string
          birthDate?: string
          phone?: string
          locationId: string
          routeId: string
          replaceExisting?: boolean
        }
      },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN, UserRole.CAPTURA])

      const leaderService = new LeaderService(context.prisma)

      // Convertir birthDate de string a Date si está presente
      const birthDate = args.input.birthDate ? new Date(args.input.birthDate) : undefined

      return leaderService.createNewLeader({
        ...args.input,
        birthDate
      })
    },
  },
}
