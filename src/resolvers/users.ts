import { GraphQLError } from 'graphql'
import type { GraphQLContext } from '@solufacil/graphql-schema'
import { UserRole } from '@solufacil/database'
import { UserService, CreateUserInput, UpdateUserInput } from '../services/UserService'
import { authenticateUser, requireRole } from '../middleware/auth'

export const userResolvers = {
  Query: {
    user: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const userService = new UserService(context.prisma)
      const user = await userService.findByIdWithEmployee(args.id)

      if (!user) {
        throw new GraphQLError('User not found', {
          extensions: { code: 'NOT_FOUND' },
        })
      }

      return user
    },

    users: async (
      _parent: unknown,
      args: { role?: UserRole; limit?: number; offset?: number },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, [UserRole.ADMIN])

      // Get users with relations for admin view
      return context.prisma.user.findMany({
        where: args.role ? { role: args.role } : undefined,
        take: args.limit ?? undefined,
        skip: args.offset ?? undefined,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: {
            include: {
              personalDataRelation: true,
              routes: true,
            },
          },
        },
      })
    },
  },

  Mutation: {
    createUser: async (
      _parent: unknown,
      args: { input: CreateUserInput },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, [UserRole.ADMIN])

      const userService = new UserService(context.prisma)
      return userService.create(args.input)
    },

    updateUser: async (
      _parent: unknown,
      args: { id: string; input: UpdateUserInput },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, [UserRole.ADMIN])

      const userService = new UserService(context.prisma)
      return userService.update(args.id, args.input)
    },

    deleteUser: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, [UserRole.ADMIN])

      const userService = new UserService(context.prisma)
      return userService.delete(args.id)
    },

    adminSetPassword: async (
      _parent: unknown,
      args: { userId: string; newPassword: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, [UserRole.ADMIN])
      const userService = new UserService(context.prisma)
      return userService.adminSetPassword(args.userId, args.newPassword)
    },
  },

  User: {
    employee: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.employee.findUnique({
        where: { user: parent.id },
        include: {
          personalDataRelation: true,
          routes: true,
        },
      })
    },

    telegramUser: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.telegramUser.findUnique({
        where: { platformUser: parent.id },
      })
    },
  },
}
