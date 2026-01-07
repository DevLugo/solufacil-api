import { GraphQLError } from 'graphql'
import { Decimal } from 'decimal.js'
import type { PrismaClient, Prisma } from '@solufacil/database'
import { PortfolioCleanupRepository } from '../repositories/PortfolioCleanupRepository'
import { AuditLogService, AuditContext } from './AuditLogService'

export interface CreatePortfolioCleanupInput {
  name: string
  description?: string
  cleanupDate: Date
  maxSignDate: Date
  routeId?: string
}

export interface CleanupPreview {
  totalLoans: number
  totalPendingAmount: Decimal
  sampleLoans: CleanupLoanPreview[]
}

export interface CleanupLoanPreview {
  id: string
  clientName: string
  clientCode: string
  signDate: Date
  pendingAmount: Decimal
  routeName: string
}

export class PortfolioCleanupService {
  private portfolioCleanupRepository: PortfolioCleanupRepository
  private auditLogService: AuditLogService

  constructor(private prisma: PrismaClient) {
    this.portfolioCleanupRepository = new PortfolioCleanupRepository(prisma)
    this.auditLogService = new AuditLogService(prisma)
  }

  async findById(id: string) {
    const cleanup = await this.portfolioCleanupRepository.findById(id)
    if (!cleanup) {
      throw new GraphQLError('Portfolio cleanup not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }
    return cleanup
  }

  async findMany(options?: {
    routeId?: string
    fromDate?: Date
    toDate?: Date
    limit?: number
    offset?: number
  }) {
    return this.portfolioCleanupRepository.findMany(options)
  }

  /**
   * Build the WHERE clause for loans eligible for cleanup
   */
  private buildEligibleLoansWhere(maxSignDate: Date, routeId?: string): Prisma.LoanWhereInput {
    const where: Prisma.LoanWhereInput = {
      signDate: { lte: maxSignDate },
      pendingAmountStored: { gt: 0 },
      excludedByCleanup: null,
      renewedDate: null,
      finishedDate: null,
    }

    if (routeId) {
      where.leadRelation = {
        routes: {
          some: { id: routeId },
        },
      }
    }

    return where
  }

  /**
   * Preview loans that would be cleaned up
   */
  async previewCleanup(maxSignDate: Date, routeId?: string): Promise<CleanupPreview> {
    const where = this.buildEligibleLoansWhere(maxSignDate, routeId)

    // Get total count
    const totalLoans = await this.prisma.loan.count({ where })

    // Get total amount
    const aggregation = await this.prisma.loan.aggregate({
      where,
      _sum: { pendingAmountStored: true },
    })
    const totalPendingAmount = new Decimal(aggregation._sum.pendingAmountStored?.toString() || '0')

    // Get sample loans (10 examples)
    const sampleLoansRaw = await this.prisma.loan.findMany({
      where,
      take: 10,
      orderBy: { signDate: 'asc' },
      include: {
        borrowerRelation: {
          include: {
            personalDataRelation: {
              select: { fullName: true, clientCode: true },
            },
          },
        },
        leadRelation: {
          include: {
            routes: { take: 1, select: { name: true } },
          },
        },
      },
    })

    const sampleLoans: CleanupLoanPreview[] = sampleLoansRaw.map((loan) => ({
      id: loan.id,
      clientName: loan.borrowerRelation?.personalDataRelation?.fullName || 'N/A',
      clientCode: loan.borrowerRelation?.personalDataRelation?.clientCode || 'N/A',
      signDate: loan.signDate!,
      pendingAmount: new Decimal(loan.pendingAmountStored.toString()),
      routeName: loan.leadRelation?.routes?.[0]?.name || 'N/A',
    }))

    return {
      totalLoans,
      totalPendingAmount,
      sampleLoans,
    }
  }

  async create(
    input: CreatePortfolioCleanupInput,
    userId: string,
    auditContext?: AuditContext
  ) {
    // Validate route exists if provided
    if (input.routeId) {
      const route = await this.prisma.route.findUnique({
        where: { id: input.routeId },
      })
      if (!route) {
        throw new GraphQLError('Route not found', {
          extensions: { code: 'NOT_FOUND' },
        })
      }
    }

    // Get all eligible loans based on maxSignDate
    const where = this.buildEligibleLoansWhere(input.maxSignDate, input.routeId)
    const eligibleLoans = await this.prisma.loan.findMany({
      where,
      select: { id: true, pendingAmountStored: true },
    })

    if (eligibleLoans.length === 0) {
      throw new GraphQLError('No loans found matching the cleanup criteria', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    const loanIds = eligibleLoans.map((l) => l.id)
    const excludedLoansCount = eligibleLoans.length
    const excludedAmount = eligibleLoans.reduce(
      (acc, loan) => acc.plus(new Decimal(loan.pendingAmountStored.toString())),
      new Decimal(0)
    )

    // Create cleanup and update loans in a transaction
    const cleanup = await this.prisma.$transaction(async (tx) => {
      // Create the cleanup record
      const newCleanup = await tx.portfolioCleanup.create({
        data: {
          name: input.name,
          description: input.description,
          cleanupDate: input.cleanupDate,
          toDate: input.maxSignDate,
          route: input.routeId || null,
          executedBy: userId,
          excludedLoansCount,
          excludedAmount,
          loansExcluded: {
            connect: loanIds.map((id) => ({ id })),
          },
        },
        include: {
          routeRelation: true,
          executedByRelation: true,
        },
      })

      return newCleanup
    })

    // Log audit
    await this.auditLogService.logCreate(
      'PortfolioCleanup',
      cleanup.id,
      {
        name: input.name,
        routeId: input.routeId,
        maxSignDate: input.maxSignDate,
        excludedLoansCount,
      },
      auditContext,
      `Created portfolio cleanup "${input.name}" with ${excludedLoansCount} loans (signDate <= ${input.maxSignDate.toISOString().split('T')[0]})`
    )

    return cleanup
  }

  async update(
    id: string,
    input: {
      name?: string
      description?: string
      cleanupDate?: Date
    },
    auditContext?: AuditContext
  ) {
    const existing = await this.portfolioCleanupRepository.findById(id)
    if (!existing) {
      throw new GraphQLError('Portfolio cleanup not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const updated = await this.prisma.portfolioCleanup.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.cleanupDate !== undefined && { cleanupDate: input.cleanupDate }),
      },
      include: {
        routeRelation: true,
      },
    })

    // Log audit
    await this.auditLogService.logUpdate(
      'PortfolioCleanup',
      id,
      { name: existing.name, description: existing.description, cleanupDate: existing.cleanupDate },
      input as Record<string, unknown>,
      auditContext,
      `Updated portfolio cleanup "${updated.name}"`
    )

    return updated
  }

  async delete(id: string, auditContext?: AuditContext): Promise<boolean> {
    const cleanup = await this.portfolioCleanupRepository.findById(id)
    if (!cleanup) {
      throw new GraphQLError('Portfolio cleanup not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    await this.portfolioCleanupRepository.delete(id)

    // Log audit
    await this.auditLogService.logDelete(
      'PortfolioCleanup',
      id,
      {
        name: cleanup.name,
        route: cleanup.route,
        excludedLoansCount: cleanup.excludedLoansCount,
      },
      auditContext,
      `Deleted portfolio cleanup "${cleanup.name}"`
    )

    return true
  }

  async getSummary(routeId?: string) {
    const where = routeId ? { route: routeId } : {}

    const cleanups = await this.prisma.portfolioCleanup.findMany({
      where,
      select: {
        excludedLoansCount: true,
        excludedAmount: true,
      },
    })

    const totalCleanups = cleanups.length
    const totalExcludedLoans = cleanups.reduce(
      (acc, c) => acc + c.excludedLoansCount,
      0
    )
    const totalExcludedAmount = cleanups.reduce(
      (acc, c) => acc.plus(new Decimal(c.excludedAmount.toString())),
      new Decimal(0)
    )

    return {
      totalCleanups,
      totalExcludedLoans,
      totalExcludedAmount,
    }
  }

  async getEligibleLoansForCleanup(routeId: string, options?: {
    fromDate?: Date
    toDate?: Date
  }) {
    const where: any = {
      leadRelation: {
        routes: {
          some: { id: routeId },
        },
      },
      badDebtDate: { not: null },
      cleanupExcludedById: null,
    }

    if (options?.fromDate || options?.toDate) {
      where.badDebtDate = {
        ...where.badDebtDate,
        ...(options?.fromDate ? { gte: options.fromDate } : {}),
        ...(options?.toDate ? { lte: options.toDate } : {}),
      }
    }

    return this.prisma.loan.findMany({
      where,
      include: {
        borrowerRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        leadRelation: {
          include: {
            personalDataRelation: true,
          },
        },
      },
      orderBy: { badDebtDate: 'desc' },
    })
  }
}
