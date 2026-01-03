import { GraphQLError } from 'graphql'
import type { GraphQLContext } from '@solufacil/graphql-schema'
import { AuthService } from '../services/AuthService'
import { authenticateUser } from '../middleware/auth'

export const authResolvers = {
  Query: {
    me: async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
      authenticateUser(context)

      const user = await context.prisma.user.findUnique({
        where: { id: context.user!.id },
        include: {
          employee: {
            include: {
              personalDataRelation: true,
            },
          },
        },
      })

      if (!user) {
        throw new GraphQLError('User not found', {
          extensions: { code: 'NOT_FOUND' },
        })
      }

      return user
    },
  },

  Mutation: {
    login: async (
      _parent: unknown,
      args: { email: string; password: string },
      context: GraphQLContext
    ) => {
      const authService = new AuthService(context.prisma)
      const result = await authService.login(args.email, args.password)
      console.log('🔐 [LOGIN] Result user:', JSON.stringify({
        id: result.user.id,
        email: result.user.email,
        employee: (result.user as any).employee,
      }, null, 2))
      return result
    },

    refreshToken: async (
      _parent: unknown,
      args: { refreshToken: string },
      context: GraphQLContext
    ) => {
      const authService = new AuthService(context.prisma)
      return authService.refreshToken(args.refreshToken)
    },

    logout: async (
      _parent: unknown,
      _args: unknown,
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      // En un sistema stateless JWT, el logout es manejado por el cliente
      // removiendo el token. Aquí solo validamos que esté autenticado.
      return true
    },

    changePassword: async (
      _parent: unknown,
      args: { oldPassword: string; newPassword: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const authService = new AuthService(context.prisma)
      return authService.changePassword(
        context.user!.id,
        args.oldPassword,
        args.newPassword
      )
    },
  },
}
