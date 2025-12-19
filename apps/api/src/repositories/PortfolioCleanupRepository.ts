import type { PrismaClient, Prisma } from '@solufacil/database'
import { Decimal } from 'decimal.js'

export class PortfolioCleanupRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.portfolioCleanup.findUnique({
      where: { id },
      include: {
        routeRelation: true,
        loansExcluded: {
          include: {
            borrowerRelation: {
              include: {
                personalDataRelation: true,
              },
            },
          },
        },
      },
    })
  }

  async findMany(options?: {
    routeId?: string
    fromDate?: Date
    toDate?: Date
    limit?: number
    offset?: number
  }) {
    const where: Prisma.PortfolioCleanupWhereInput = {}

    if (options?.routeId) {
      where.route = options.routeId
    }

    if (options?.fromDate || options?.toDate) {
      where.cleanupDate = {}
      if (options?.fromDate) {
        where.cleanupDate.gte = options.fromDate
      }
      if (options?.toDate) {
        where.cleanupDate.lte = options.toDate
      }
    }

    return this.prisma.portfolioCleanup.findMany({
      where,
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
      orderBy: { cleanupDate: 'desc' },
      include: {
        routeRelation: true,
        loansExcluded: {
          select: {
            id: true,
            pendingAmountStored: true,
            borrowerRelation: {
              include: {
                personalDataRelation: {
                  select: {
                    fullName: true,
                  },
                },
              },
            },
          },
        },
      },
    })
  }

  async create(data: {
    name: string
    description?: string
    cleanupDate: Date
    fromDate?: Date
    toDate?: Date
    routeId: string
    executedById: string
    loanIds: string[]
  }) {
    // Calculate totals from loans
    const loans = await this.prisma.loan.findMany({
      where: { id: { in: data.loanIds } },
      select: { pendingAmountStored: true },
    })

    const excludedLoansCount = loans.length
    const excludedAmount = loans.reduce(
      (acc, loan) => acc.plus(new Decimal(loan.pendingAmountStored.toString())),
      new Decimal(0)
    )

    return this.prisma.portfolioCleanup.create({
      data: {
        name: data.name,
        description: data.description,
        cleanupDate: data.cleanupDate,
        fromDate: data.fromDate,
        toDate: data.toDate,
        route: data.routeId,
        executedBy: data.executedById,
        excludedLoansCount,
        excludedAmount,
        loansExcluded: {
          connect: data.loanIds.map((id) => ({ id })),
        },
      },
      include: {
        routeRelation: true,
        loansExcluded: {
          include: {
            borrowerRelation: {
              include: {
                personalDataRelation: true,
              },
            },
          },
        },
      },
    })
  }

  async delete(id: string) {
    // First disconnect all loans
    await this.prisma.portfolioCleanup.update({
      where: { id },
      data: {
        loansExcluded: {
          set: [],
        },
      },
    })

    return this.prisma.portfolioCleanup.delete({
      where: { id },
    })
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.prisma.portfolioCleanup.count({
      where: { id },
    })
    return count > 0
  }

  async getExcludedLoanIds(cleanupId: string): Promise<string[]> {
    const cleanup = await this.prisma.portfolioCleanup.findUnique({
      where: { id: cleanupId },
      select: {
        loansExcluded: {
          select: { id: true },
        },
      },
    })

    return cleanup?.loansExcluded.map((l) => l.id) || []
  }
}
