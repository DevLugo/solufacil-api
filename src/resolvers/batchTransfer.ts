import type { GraphQLContext } from '@solufacil/graphql-schema'
import { BatchTransferService } from '../services/BatchTransferService'
import { authenticateUser, requireRole } from '../middleware/auth'

export interface DrainRoutesInput {
  routeIds: string[]
  destinationAccountId: string
  description?: string
}

export interface RouteAmountInput {
  routeId: string
  amount: string
}

export interface DistributeMoneyInput {
  sourceAccountId: string
  routeIds: string[]
  distributionMode: 'FIXED_EQUAL' | 'VARIABLE'
  fixedAmount?: string
  variableAmounts?: RouteAmountInput[]
  description?: string
}

export const batchTransferResolvers = {
  Mutation: {
    drainRoutes: async (
      _parent: unknown,
      args: { input: DrainRoutesInput },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, ['ADMIN'])

      const batchTransferService = new BatchTransferService(context.prisma)
      const result = await batchTransferService.drainRoutes(args.input)

      return {
        success: result.success,
        message: result.message,
        transactionsCreated: result.transactionsCreated,
        totalAmount: result.totalAmount.toString(),
        transactions: result.transactions,
      }
    },

    distributeMoney: async (
      _parent: unknown,
      args: { input: DistributeMoneyInput },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, ['ADMIN'])

      const batchTransferService = new BatchTransferService(context.prisma)
      const result = await batchTransferService.distributeMoney(args.input)

      return {
        success: result.success,
        message: result.message,
        transactionsCreated: result.transactionsCreated,
        totalAmount: result.totalAmount.toString(),
        transactions: result.transactions,
      }
    },
  },
}
