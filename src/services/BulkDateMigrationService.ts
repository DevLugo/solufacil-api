import { GraphQLError } from 'graphql'
import type { PrismaClient } from '@solufacil/database'

export interface BulkDateMigrationInput {
  startCreatedAt: Date
  endCreatedAt: Date
  newBusinessDate: Date
  routeId?: string
}

export interface BulkDateMigrationPreview {
  transactionsCount: number
  loanPaymentsCount: number
  loansCount: number
  totalRecords: number
}

export interface BulkDateMigrationResult {
  success: boolean
  message: string
  transactionsUpdated: number
  loanPaymentsUpdated: number
  loansUpdated: number
  totalUpdated: number
}

export class BulkDateMigrationService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Preview how many records will be affected by the migration
   */
  async previewMigration(input: BulkDateMigrationInput): Promise<BulkDateMigrationPreview> {
    // Validate input
    this.validateInput(input)

    const baseCreatedAtFilter = {
      createdAt: {
        gte: input.startCreatedAt,
        lte: input.endCreatedAt,
      },
    }

    // Build where clauses with optional routeId filter (via lead's current routes)
    const routeFilter = input.routeId
      ? { loan: { leadRelation: { routes: { some: { id: input.routeId } } } } }
      : {}

    const accountEntryWhere = {
      ...baseCreatedAtFilter,
      ...routeFilter,
    }

    const loanPaymentWhere = {
      ...baseCreatedAtFilter,
      ...(input.routeId && { loanRelation: { leadRelation: { routes: { some: { id: input.routeId } } } } }),
    }

    const loanWhere = {
      ...baseCreatedAtFilter,
      ...(input.routeId && { leadRelation: { routes: { some: { id: input.routeId } } } }),
    }

    // Count records in parallel for performance
    const [transactionsCount, loanPaymentsCount, loansCount] = await Promise.all([
      this.prisma.accountEntry.count({ where: accountEntryWhere }),
      this.prisma.loanPayment.count({ where: loanPaymentWhere }),
      this.prisma.loan.count({ where: loanWhere }),
    ])

    return {
      transactionsCount,
      loanPaymentsCount,
      loansCount,
      totalRecords: transactionsCount + loanPaymentsCount + loansCount,
    }
  }

  /**
   * Execute the bulk date migration
   * Updates Transaction.date, LoanPayment.receivedAt, and Loan.signDate
   * while preserving createdAt timestamps
   */
  async executeMigration(input: BulkDateMigrationInput): Promise<BulkDateMigrationResult> {
    // Validate input
    this.validateInput(input)

    // Get preview to check if there are records to update
    const preview = await this.previewMigration(input)

    if (preview.totalRecords === 0) {
      return {
        success: true,
        message: 'No hay registros para migrar en el rango seleccionado',
        transactionsUpdated: 0,
        loanPaymentsUpdated: 0,
        loansUpdated: 0,
        totalUpdated: 0,
      }
    }

    // Execute all updates in a single atomic transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const baseCreatedAtFilter = {
        createdAt: {
          gte: input.startCreatedAt,
          lte: input.endCreatedAt,
        },
      }

      // Build where clauses with optional routeId filter (via lead's current routes)
      const routeFilter = input.routeId
        ? { loan: { leadRelation: { routes: { some: { id: input.routeId } } } } }
        : {}

      const accountEntryWhere = {
        ...baseCreatedAtFilter,
        ...routeFilter,
      }

      const loanPaymentWhere = {
        ...baseCreatedAtFilter,
        ...(input.routeId && { loanRelation: { leadRelation: { routes: { some: { id: input.routeId } } } } }),
      }

      const loanWhere = {
        ...baseCreatedAtFilter,
        ...(input.routeId && { leadRelation: { routes: { some: { id: input.routeId } } } }),
      }

      // Update all three entity types in parallel
      const [transactionsResult, loanPaymentsResult, loansResult] = await Promise.all([
        tx.accountEntry.updateMany({
          where: accountEntryWhere,
          data: { entryDate: input.newBusinessDate },
        }),
        tx.loanPayment.updateMany({
          where: loanPaymentWhere,
          data: { receivedAt: input.newBusinessDate },
        }),
        tx.loan.updateMany({
          where: loanWhere,
          data: { signDate: input.newBusinessDate },
        }),
      ])

      return {
        transactionsUpdated: transactionsResult.count,
        loanPaymentsUpdated: loanPaymentsResult.count,
        loansUpdated: loansResult.count,
      }
    })

    const totalUpdated =
      result.transactionsUpdated + result.loanPaymentsUpdated + result.loansUpdated

    return {
      success: true,
      message: `Se migraron ${totalUpdated} registros correctamente`,
      transactionsUpdated: result.transactionsUpdated,
      loanPaymentsUpdated: result.loanPaymentsUpdated,
      loansUpdated: result.loansUpdated,
      totalUpdated,
    }
  }

  /**
   * Validate input parameters
   */
  private validateInput(input: BulkDateMigrationInput): void {
    // Validate date range
    if (input.startCreatedAt >= input.endCreatedAt) {
      throw new GraphQLError('La fecha de inicio debe ser anterior a la fecha de fin', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    // Safety check: prevent accidental migration of very large date ranges
    const rangeDays = Math.abs(
      (input.endCreatedAt.getTime() - input.startCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
    )
    if (rangeDays > 7) {
      throw new GraphQLError(
        'El rango de fechas no puede ser mayor a 7 días por seguridad. Contacta al administrador si necesitas migrar más datos.',
        {
          extensions: { code: 'BAD_USER_INPUT' },
        }
      )
    }
  }
}
