import type { PrismaClient, LoanPayment, PaymentMethod, Prisma } from '@solufacil/database'
import { Decimal } from 'decimal.js'

export class PaymentRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.loanPayment.findUnique({
      where: { id },
      include: {
        loanRelation: {
          include: {
            borrowerRelation: {
              include: {
                personalDataRelation: true,
              },
            },
            loantypeRelation: true,
          },
        },
        transactions: true,
        leadPaymentReceivedRelation: true,
      },
    })
  }

  async findByLoanId(loanId: string, options?: { limit?: number; offset?: number }) {
    return this.prisma.loanPayment.findMany({
      where: { loan: loanId },
      take: options?.limit,
      skip: options?.offset,
      orderBy: { receivedAt: 'desc' },
      include: {
        transactions: true,
      },
    })
  }

  async create(
    data: {
      amount: Decimal
      comission?: Decimal
      receivedAt: Date
      paymentMethod: PaymentMethod
      type?: string
      loan: string
      leadPaymentReceived?: string
    },
    tx?: Prisma.TransactionClient
  ) {
    const client = tx || this.prisma
    return client.loanPayment.create({
      data: {
        amount: data.amount,
        comission: data.comission || new Decimal(0),
        receivedAt: data.receivedAt,
        paymentMethod: data.paymentMethod,
        type: data.type || 'PAYMENT',
        loan: data.loan,
        leadPaymentReceived: data.leadPaymentReceived,
      },
      include: {
        loanRelation: true,
        transactions: true,
      },
    })
  }

  async createLeadPaymentReceived(data: {
    expectedAmount: Decimal
    paidAmount: Decimal
    cashPaidAmount: Decimal
    bankPaidAmount: Decimal
    falcoAmount?: Decimal
    paymentStatus: string
    lead: string
    agent: string
    createdAt?: Date
  }) {
    return this.prisma.leadPaymentReceived.create({
      data: {
        expectedAmount: data.expectedAmount,
        paidAmount: data.paidAmount,
        cashPaidAmount: data.cashPaidAmount,
        bankPaidAmount: data.bankPaidAmount,
        falcoAmount: data.falcoAmount || new Decimal(0),
        paymentStatus: data.paymentStatus,
        lead: data.lead,
        agent: data.agent,
        ...(data.createdAt && { createdAt: data.createdAt }),
      },
      include: {
        leadRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        agentRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        payments: true,
      },
    })
  }

  async update(
    id: string,
    data: {
      amount?: Decimal
      comission?: Decimal
      paymentMethod?: PaymentMethod
    },
    tx?: Prisma.TransactionClient
  ) {
    const client = tx || this.prisma
    return client.loanPayment.update({
      where: { id },
      data: {
        ...(data.amount && { amount: data.amount }),
        ...(data.comission !== undefined && { comission: data.comission }),
        ...(data.paymentMethod && { paymentMethod: data.paymentMethod }),
      },
      include: {
        loanRelation: true,
        transactions: true,
      },
    })
  }

  async delete(id: string, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma
    return client.loanPayment.delete({
      where: { id },
      include: {
        loanRelation: true,
        transactions: true,
      },
    })
  }

  async findLeadPaymentReceivedById(id: string) {
    return this.prisma.leadPaymentReceived.findUnique({
      where: { id },
      include: {
        payments: {
          include: {
            loanRelation: {
              include: {
                borrowerRelation: {
                  include: {
                    personalDataRelation: true,
                  },
                },
              },
            },
          },
        },
        leadRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        agentRelation: {
          include: {
            personalDataRelation: true,
          },
        },
      },
    })
  }

  async updateLeadPaymentReceived(
    id: string,
    data: {
      expectedAmount?: Decimal
      paidAmount?: Decimal
      cashPaidAmount?: Decimal
      bankPaidAmount?: Decimal
      falcoAmount?: Decimal
      paymentStatus?: string
    },
    tx?: Prisma.TransactionClient
  ) {
    const client = tx || this.prisma
    return client.leadPaymentReceived.update({
      where: { id },
      data: {
        ...(data.expectedAmount !== undefined && { expectedAmount: data.expectedAmount }),
        ...(data.paidAmount !== undefined && { paidAmount: data.paidAmount }),
        ...(data.cashPaidAmount !== undefined && { cashPaidAmount: data.cashPaidAmount }),
        ...(data.bankPaidAmount !== undefined && { bankPaidAmount: data.bankPaidAmount }),
        ...(data.falcoAmount !== undefined && { falcoAmount: data.falcoAmount }),
        ...(data.paymentStatus !== undefined && { paymentStatus: data.paymentStatus }),
      },
      include: {
        payments: true,
        leadRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        agentRelation: {
          include: {
            personalDataRelation: true,
          },
        },
      },
    })
  }
}
