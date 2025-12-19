import type { PrismaClient, Transaction, TransactionType, Prisma } from '@solufacil/database'
import { Decimal } from 'decimal.js'

export class TransactionRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.transaction.findUnique({
      where: { id },
      include: {
        sourceAccountRelation: true,
        destinationAccountRelation: true,
        loanRelation: true,
        loanPaymentRelation: true,
        routeRelation: true,
        leadRelation: {
          include: {
            personalDataRelation: true,
          },
        },
      },
    })
  }

  async findMany(options?: {
    type?: TransactionType
    routeId?: string
    accountId?: string
    fromDate?: Date
    toDate?: Date
    limit?: number
    offset?: number
  }) {
    const where: Prisma.TransactionWhereInput = {}

    if (options?.type) {
      where.type = options.type
    }

    if (options?.routeId) {
      where.route = options.routeId
    }

    if (options?.accountId) {
      where.OR = [
        { sourceAccount: options.accountId },
        { destinationAccount: options.accountId },
      ]
    }

    if (options?.fromDate || options?.toDate) {
      where.date = {}
      if (options?.fromDate) {
        where.date.gte = options.fromDate
      }
      if (options?.toDate) {
        where.date.lte = options.toDate
      }
    }

    const [transactions, totalCount] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        take: options?.limit ?? 50,
        skip: options?.offset ?? 0,
        orderBy: { date: 'desc' },
        include: {
          sourceAccountRelation: true,
          destinationAccountRelation: true,
          loanRelation: {
            include: {
              borrowerRelation: {
                include: {
                  personalDataRelation: true,
                },
              },
            },
          },
          routeRelation: true,
          leadRelation: {
            include: {
              personalDataRelation: true,
            },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
    ])

    return { transactions, totalCount }
  }

  async create(
    data: {
      amount: Decimal
      date: Date
      type: TransactionType
      incomeSource?: string
      expenseSource?: string
      profitAmount?: Decimal
      returnToCapital?: Decimal
      sourceAccountId?: string
      destinationAccountId?: string
      loanId?: string
      loanPaymentId?: string
      routeId?: string
      leadId?: string
      leadPaymentReceivedId?: string
    },
    tx?: Prisma.TransactionClient
  ) {
    const client = tx || this.prisma

    // Para transacciones INCOME que no tienen sourceAccount, usamos destinationAccount como source
    // (el dinero "entra" a la cuenta destino desde una fuente externa/pago)
    const sourceAccount = data.sourceAccountId || data.destinationAccountId || ''

    return client.transaction.create({
      data: {
        amount: data.amount,
        date: data.date,
        type: data.type,
        incomeSource: data.incomeSource,
        expenseSource: data.expenseSource,
        profitAmount: data.profitAmount,
        returnToCapital: data.returnToCapital,
        sourceAccount,
        destinationAccount: data.destinationAccountId,
        loan: data.loanId,
        loanPayment: data.loanPaymentId,
        route: data.routeId,
        lead: data.leadId,
        leadPaymentReceived: data.leadPaymentReceivedId,
      },
      include: {
        sourceAccountRelation: true,
        destinationAccountRelation: true,
      },
    })
  }

  async update(
    id: string,
    data: {
      amount?: Decimal
      expenseSource?: string
      incomeSource?: string
      sourceAccountId?: string
    },
    tx?: Prisma.TransactionClient
  ) {
    const client = tx || this.prisma

    return client.transaction.update({
      where: { id },
      data: {
        amount: data.amount,
        expenseSource: data.expenseSource,
        incomeSource: data.incomeSource,
        sourceAccount: data.sourceAccountId,
      },
      include: {
        sourceAccountRelation: true,
        destinationAccountRelation: true,
      },
    })
  }

  async delete(id: string, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma

    return client.transaction.delete({
      where: { id },
    })
  }
}
