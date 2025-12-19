import type { GraphQLContext } from '@solufacil/graphql-schema'
import { LoantypeService } from '../services/LoantypeService'
import { authenticateUser, requireRole } from '../middleware/auth'

export const loantypeResolvers = {
  Query: {
    loantype: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loantypeService = new LoantypeService(context.prisma)
      return loantypeService.findById(args.id)
    },

    loantypes: async (
      _parent: unknown,
      _args: { isActive?: boolean },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const loantypeService = new LoantypeService(context.prisma)
      // Note: isActive filter ignored - field doesn't exist in Prisma schema
      return loantypeService.findMany()
    },
  },

  Mutation: {
    createLoantype: async (
      _parent: unknown,
      args: {
        input: {
          name: string
          weekDuration: number
          rate: string
          interestRate: string
          loanPaymentComission: string
          loanGrantedComission: string
          maxAmount?: string
          maxTerm?: number
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, ['ADMIN'])

      const loantypeService = new LoantypeService(context.prisma)
      return loantypeService.create(args.input)
    },

    updateLoantype: async (
      _parent: unknown,
      args: {
        id: string
        input: {
          name?: string
          weekDuration?: number
          rate?: string
          interestRate?: string
          loanPaymentComission?: string
          loanGrantedComission?: string
          maxAmount?: string
          maxTerm?: number
          isActive?: boolean
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, ['ADMIN'])

      const loantypeService = new LoantypeService(context.prisma)
      return loantypeService.update(args.id, args.input)
    },
  },
}
