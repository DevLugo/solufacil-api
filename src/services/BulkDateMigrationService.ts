import { GraphQLError } from 'graphql'
import type { PrismaClient } from '@solufacil/database'

export interface BulkDateMigrationInput {
  startCreatedAt: Date
  endCreatedAt: Date
  newBusinessDate: Date
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

    const where = {
      createdAt: {
        gte: input.startCreatedAt,
        lte: input.endCreatedAt,
      },
    }

    // Count records in parallel for performance
    const [transactionsCount, loanPaymentsCount, loansCount] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.loanPayment.count({ where }),
      this.prisma.loan.count({ where }),
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
      const where = {
        createdAt: {
          gte: input.startCreatedAt,
          lte: input.endCreatedAt,
        },
      }

      // Update all three entity types in parallel
      const [transactionsResult, loanPaymentsResult, loansResult] = await Promise.all([
        tx.transaction.updateMany({
          where,
          data: { date: input.newBusinessDate },
        }),
        tx.loanPayment.updateMany({
          where,
          data: { receivedAt: input.newBusinessDate },
        }),
        tx.loan.updateMany({
          where,
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

    // Prevent future dates
    const now = new Date()
    if (input.startCreatedAt > now || input.endCreatedAt > now) {
      throw new GraphQLError('Las fechas de createdAt no pueden ser futuras', {
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
