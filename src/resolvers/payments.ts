import type { GraphQLContext } from '@solufacil/graphql-schema'
import type { PaymentMethod } from '@solufacil/database'
import { PaymentService } from '../services/PaymentService'
import { authenticateUser } from '../middleware/auth'

export const paymentResolvers = {
  Query: {
    loanPayments: async (
      _parent: unknown,
      args: { loanId: string; limit?: number; offset?: number },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const paymentService = new PaymentService(context.prisma)
      return paymentService.findByLoanId(args.loanId, {
        limit: args.limit ?? undefined,
        offset: args.offset ?? undefined,
      })
    },

    loanPaymentsByLeadAndDate: async (
      _parent: unknown,
      args: { leadId: string; startDate: Date; endDate: Date },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const startDate = new Date(args.startDate)
      const endDate = new Date(args.endDate)

      // DEBUG: Log query parameters
      console.log('=== DEBUG loanPaymentsByLeadAndDate ===')
      console.log('args:', args)
      console.log('startDate parsed:', startDate)
      console.log('endDate parsed:', endDate)

      // DEBUG: Check all payments in date range (regardless of lead)
      const allPaymentsInRange = await context.prisma.loanPayment.findMany({
        where: {
          receivedAt: {
            gte: startDate,
            lt: endDate,
          },
        },
        include: {
          leadPaymentReceivedRelation: true,
        },
      })
      console.log('All payments in date range:', allPaymentsInRange.length)
      allPaymentsInRange.forEach((p: typeof allPaymentsInRange[number], i: number) => {
        console.log(`  Payment ${i}: id=${p.id}, leadPaymentReceived=${p.leadPaymentReceived}, LPR.lead=${p.leadPaymentReceivedRelation?.lead}`)
      })

      // DEBUG: Check all LeadPaymentReceived for this lead
      const allLPRForLead = await context.prisma.leadPaymentReceived.findMany({
        where: {
          lead: args.leadId,
        },
        include: {
          payments: true,
        },
      })
      console.log('All LeadPaymentReceived for lead:', allLPRForLead.length)
      allLPRForLead.forEach((lpr: typeof allLPRForLead[number], i: number) => {
        console.log(`  LPR ${i}: id=${lpr.id}, createdAt=${lpr.createdAt}, payments count=${lpr.payments.length}`)
      })

      // Query loan payments by lead (through leadPaymentReceived) and date range
      // This mirrors Keystone's GET_LEAD_PAYMENTS approach
      const whereClause = {
        receivedAt: {
          gte: startDate,
          lt: endDate,
        },
        leadPaymentReceivedRelation: {
          lead: args.leadId,
        },
      }
      console.log('whereClause:', JSON.stringify(whereClause, null, 2))

      const results = await context.prisma.loanPayment.findMany({
        where: whereClause,
        orderBy: {
          receivedAt: 'asc',
        },
      })

      console.log('Final results count:', results.length)
      console.log('Final results:', results)
      console.log('======================================')

      return results
    },

    leadPaymentReceivedByLeadAndDate: async (
      _parent: unknown,
      args: { leadId: string; startDate: Date; endDate: Date },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const startDate = new Date(args.startDate)
      const endDate = new Date(args.endDate)

      // DEBUG: Log what we're searching for
      console.log('=== DEBUG leadPaymentReceivedByLeadAndDate ===')
      console.log('leadId:', args.leadId)
      console.log('startDate:', startDate.toISOString())
      console.log('endDate:', endDate.toISOString())

      // DEBUG: Ver TODOS los LeadPaymentReceived de este lead
      const allLPR = await context.prisma.leadPaymentReceived.findMany({
        where: { lead: args.leadId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      })
      console.log('Últimos 5 LeadPaymentReceived para este lead:')
      allLPR.forEach((lpr: typeof allLPR[number], i: number) => {
        console.log(`  ${i}: id=${lpr.id}, createdAt=${lpr.createdAt.toISOString()}`)
      })

      // Find LeadPaymentReceived for this lead within the specified date range
      const result = await context.prisma.leadPaymentReceived.findFirst({
        where: {
          lead: args.leadId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          payments: true,
        },
      })

      console.log('Result:', result ? `Found id=${result.id}` : 'NOT FOUND')
      console.log('==============================================')

      return result
    },

    leadPaymentReceivedById: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const result = await context.prisma.leadPaymentReceived.findUnique({
        where: { id: args.id },
        include: { payments: true },
      })

      return result
    },

    falcosPendientes: async (
      _parent: unknown,
      args: { routeId?: string; leadId?: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      // Build the where clause to find LeadPaymentReceived with falcoAmount > 0
      // and calculate remaining falco (falcoAmount - sum of compensatory payments)
      const results = await context.prisma.leadPaymentReceived.findMany({
        where: {
          falcoAmount: {
            gt: 0,
          },
          ...(args.leadId && { lead: args.leadId }),
          ...(args.routeId && {
            leadRelation: {
              routes: {
                some: {
                  id: args.routeId,
                },
              },
            },
          }),
        },
        include: {
          falcoCompensatoryPayments: true,
          leadRelation: {
            include: {
              personalDataRelation: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      })

      // Filter to only return those with remaining falco balance
      return results.filter((lpr) => {
        const compensatedAmount = lpr.falcoCompensatoryPayments.reduce(
          (sum, payment) => sum + parseFloat(payment.amount.toString()),
          0
        )
        const remainingFalco = parseFloat(lpr.falcoAmount.toString()) - compensatedAmount
        return remainingFalco > 0
      })
    },
  },

  Mutation: {
    createLeadPaymentReceived: async (
      _parent: unknown,
      args: {
        input: {
          leadId: string
          agentId: string
          expectedAmount: string
          paidAmount: string
          cashPaidAmount: string
          bankPaidAmount: string
          falcoAmount?: string
          paymentDate: Date | string
          payments: {
            loanId: string
            amount: string
            comission?: string
            paymentMethod: PaymentMethod
          }[]
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const paymentService = new PaymentService(context.prisma)
      return paymentService.createLeadPaymentReceived(args.input)
    },

    updateLoanPayment: async (
      _parent: unknown,
      args: {
        id: string
        input: {
          amount?: string
          comission?: string
          paymentMethod?: PaymentMethod
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const paymentService = new PaymentService(context.prisma)
      return paymentService.updateLoanPayment(args.id, args.input)
    },

    deleteLoanPayment: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const paymentService = new PaymentService(context.prisma)
      return paymentService.deleteLoanPayment(args.id)
    },

    updateLeadPaymentReceived: async (
      _parent: unknown,
      args: {
        id: string
        input: {
          expectedAmount?: string
          paidAmount?: string
          cashPaidAmount?: string
          bankPaidAmount?: string
          falcoAmount?: string
          payments?: {
            paymentId?: string
            loanId: string
            amount: string
            comission?: string
            paymentMethod: PaymentMethod
            isDeleted?: boolean
          }[]
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const paymentService = new PaymentService(context.prisma)
      return paymentService.updateLeadPaymentReceived(args.id, args.input)
    },

    createFalcoCompensatoryPayment: async (
      _parent: unknown,
      args: {
        input: {
          leadPaymentReceivedId: string
          amount: string
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const paymentService = new PaymentService(context.prisma)
      return paymentService.createFalcoCompensatoryPayment(args.input)
    },
  },

  LoanPayment: {
    loan: async (parent: { loan: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.loan.findUnique({
        where: { id: parent.loan },
      })
    },

    leadPaymentReceived: async (
      parent: { leadPaymentReceived?: string },
      _args: unknown,
      context: GraphQLContext
    ) => {
      if (!parent.leadPaymentReceived) return null
      return context.prisma.leadPaymentReceived.findUnique({
        where: { id: parent.leadPaymentReceived },
      })
    },

    transactions: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      // Read from AccountEntry instead of Transaction
      const entries = await context.prisma.accountEntry.findMany({
        where: { loanPaymentId: parent.id },
        orderBy: { entryDate: 'desc' },
      })
      return entries.map(e => ({
        ...e,
        date: e.entryDate,
        sourceAccount: e.accountId,
        route: null, // Route is resolved via Transaction resolver using snapshotLeadId
        lead: e.snapshotLeadId,
      }))
    },
  },

  LeadPaymentReceived: {
    lead: async (parent: { lead: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.employee.findUnique({
        where: { id: parent.lead },
        include: {
          personalDataRelation: true,
        },
      })
    },

    agent: async (parent: { agent: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.employee.findUnique({
        where: { id: parent.agent },
        include: {
          personalDataRelation: true,
        },
      })
    },

    payments: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.loanPayment.findMany({
        where: { leadPaymentReceived: parent.id },
      })
    },

    falcoCompensatoryPayments: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.falcoCompensatoryPayment.findMany({
        where: { leadPaymentReceived: parent.id },
        orderBy: { createdAt: 'desc' },
      })
    },
  },

  FalcoCompensatoryPayment: {
    leadPaymentReceived: async (
      parent: { leadPaymentReceived: string },
      _args: unknown,
      context: GraphQLContext
    ) => {
      return context.prisma.leadPaymentReceived.findUnique({
        where: { id: parent.leadPaymentReceived },
      })
    },
  },
}
