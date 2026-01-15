import { GraphQLError } from 'graphql'
import type { PrismaClient, Prisma } from '@solufacil/database'

export interface BulkDateMigrationInput {
  startBusinessDate: Date
  endBusinessDate: Date
  newBusinessDate: Date
  routeId?: string
}

export interface BulkDateMigrationPreview {
  transactionsCount: number
  loanPaymentsCount: number
  loansCount: number
  leadPaymentReceivedCount: number
  totalRecords: number
}

export interface BulkDateMigrationResult {
  success: boolean
  message: string
  transactionsUpdated: number
  loanPaymentsUpdated: number
  loansUpdated: number
  leadPaymentReceivedUpdated: number
  totalUpdated: number
}

export class BulkDateMigrationService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Preview how many records will be affected by the migration
   */
  async previewMigration(input: BulkDateMigrationInput): Promise<BulkDateMigrationPreview> {
    this.validateInput(input)

    const { loanWhere, loanPaymentWhere, accountEntryWhere, leadPaymentReceivedWhere } =
      this.buildWhereFilters(input)

    const [transactionsCount, loanPaymentsCount, loansCount, leadPaymentReceivedCount] =
      await Promise.all([
        this.prisma.accountEntry.count({ where: accountEntryWhere }),
        this.prisma.loanPayment.count({ where: loanPaymentWhere }),
        this.prisma.loan.count({ where: loanWhere }),
        this.prisma.leadPaymentReceived.count({ where: leadPaymentReceivedWhere }),
      ])

    return {
      transactionsCount,
      loanPaymentsCount,
      loansCount,
      leadPaymentReceivedCount,
      totalRecords: transactionsCount + loanPaymentsCount + loansCount + leadPaymentReceivedCount,
    }
  }

  /**
   * Execute the bulk date migration
   * Updates AccountEntry.entryDate, LoanPayment.receivedAt, Loan.signDate, and LeadPaymentReceived.createdAt
   * Also syncs AccountEntry dates with their parent LoanPayment and Loan
   */
  async executeMigration(input: BulkDateMigrationInput): Promise<BulkDateMigrationResult> {
    this.validateInput(input)

    // Execute everything in a single atomic transaction to avoid race conditions
    const result = await this.prisma.$transaction(
      async (tx) => {
        const { loanWhere, loanPaymentWhere, accountEntryWhere, leadPaymentReceivedWhere } =
          this.buildWhereFilters(input)

        // Get IDs of entities that will be migrated for syncing related AccountEntries
        const [loanPaymentsToMigrate, loansToMigrate] = await Promise.all([
          tx.loanPayment.findMany({
            where: loanPaymentWhere,
            select: { id: true },
          }),
          tx.loan.findMany({
            where: loanWhere,
            select: { id: true },
          }),
        ])
        const loanPaymentIds = loanPaymentsToMigrate.map((lp) => lp.id)
        const loanIds = loansToMigrate.map((l) => l.id)

        // Count before updating (for accurate reporting)
        const [transactionsCount, loanPaymentsCount, loansCount, leadPaymentReceivedCount] =
          await Promise.all([
            tx.accountEntry.count({ where: accountEntryWhere }),
            tx.loanPayment.count({ where: loanPaymentWhere }),
            tx.loan.count({ where: loanWhere }),
            tx.leadPaymentReceived.count({ where: leadPaymentReceivedWhere }),
          ])

        if (
          transactionsCount + loanPaymentsCount + loansCount + leadPaymentReceivedCount ===
          0
        ) {
          return {
            transactionsUpdated: 0,
            loanPaymentsUpdated: 0,
            loansUpdated: 0,
            leadPaymentReceivedUpdated: 0,
          }
        }

        // Update all entities
        const [transactionsResult, loanPaymentsResult, loansResult, leadPaymentReceivedResult] =
          await Promise.all([
            // Update AccountEntry by date filter
            tx.accountEntry.updateMany({
              where: accountEntryWhere,
              data: { entryDate: input.newBusinessDate },
            }),
            // Update LoanPayments
            tx.loanPayment.updateMany({
              where: loanPaymentWhere,
              data: { receivedAt: input.newBusinessDate },
            }),
            // Update Loans
            tx.loan.updateMany({
              where: loanWhere,
              data: { signDate: input.newBusinessDate },
            }),
            // Update LeadPaymentReceived (day capture records)
            tx.leadPaymentReceived.updateMany({
              where: leadPaymentReceivedWhere,
              data: { createdAt: input.newBusinessDate },
            }),
          ])

        let additionalEntriesUpdated = 0

        // Sync AccountEntries linked to migrated LoanPayments (payment entries)
        // Only update entries that match the route filter to avoid cross-route updates
        if (loanPaymentIds.length > 0) {
          const syncPaymentEntriesResult = await tx.accountEntry.updateMany({
            where: {
              loanPaymentId: { in: loanPaymentIds },
              entryDate: { not: input.newBusinessDate },
              // Respect route filter to avoid updating entries from other routes
              ...(input.routeId && { snapshotRouteId: input.routeId }),
            },
            data: { entryDate: input.newBusinessDate },
          })
          additionalEntriesUpdated += syncPaymentEntriesResult.count
        }

        // Sync AccountEntries linked to migrated Loans (LOAN_GRANT entries)
        // These have loanId but no loanPaymentId
        if (loanIds.length > 0) {
          const syncLoanEntriesResult = await tx.accountEntry.updateMany({
            where: {
              loanId: { in: loanIds },
              loanPaymentId: null, // Only LOAN_GRANT type entries
              entryDate: { not: input.newBusinessDate },
              // Respect route filter to avoid updating entries from other routes
              ...(input.routeId && { snapshotRouteId: input.routeId }),
            },
            data: { entryDate: input.newBusinessDate },
          })
          additionalEntriesUpdated += syncLoanEntriesResult.count
        }

        return {
          transactionsUpdated: transactionsResult.count + additionalEntriesUpdated,
          loanPaymentsUpdated: loanPaymentsResult.count,
          loansUpdated: loansResult.count,
          leadPaymentReceivedUpdated: leadPaymentReceivedResult.count,
        }
      },
      {
        timeout: 60000, // 60 seconds for large migrations
      }
    )

    const totalUpdated =
      result.transactionsUpdated +
      result.loanPaymentsUpdated +
      result.loansUpdated +
      result.leadPaymentReceivedUpdated

    if (totalUpdated === 0) {
      return {
        success: true,
        message: 'No hay registros para migrar en el rango seleccionado',
        transactionsUpdated: 0,
        loanPaymentsUpdated: 0,
        loansUpdated: 0,
        leadPaymentReceivedUpdated: 0,
        totalUpdated: 0,
      }
    }

    return {
      success: true,
      message: `Se migraron ${totalUpdated} registros correctamente`,
      transactionsUpdated: result.transactionsUpdated,
      loanPaymentsUpdated: result.loanPaymentsUpdated,
      loansUpdated: result.loansUpdated,
      leadPaymentReceivedUpdated: result.leadPaymentReceivedUpdated,
      totalUpdated,
    }
  }

  /**
   * Build where filters for all entities
   * Uses snapshotRouteId for reliable route filtering (avoids null relation issues)
   */
  private buildWhereFilters(input: BulkDateMigrationInput): {
    loanWhere: Prisma.LoanWhereInput
    loanPaymentWhere: Prisma.LoanPaymentWhereInput
    accountEntryWhere: Prisma.AccountEntryWhereInput
    leadPaymentReceivedWhere: Prisma.LeadPaymentReceivedWhereInput
  } {
    const dateRange = {
      gte: input.startBusinessDate,
      lte: input.endBusinessDate,
    }

    // For Loan: filter by signDate and optionally by lead's routes
    const loanWhere: Prisma.LoanWhereInput = {
      signDate: dateRange,
      ...(input.routeId && {
        OR: [
          // Lead is assigned to the route
          { leadRelation: { routes: { some: { id: input.routeId } } } },
          // OR grantor is assigned to the route (fallback if no lead)
          {
            lead: null,
            grantorRelation: { routes: { some: { id: input.routeId } } },
          },
        ],
      }),
    }

    // For LoanPayment: filter by receivedAt and loan's route
    const loanPaymentWhere: Prisma.LoanPaymentWhereInput = {
      receivedAt: dateRange,
      ...(input.routeId && {
        loanRelation: {
          OR: [
            { leadRelation: { routes: { some: { id: input.routeId } } } },
            {
              lead: null,
              grantorRelation: { routes: { some: { id: input.routeId } } },
            },
          ],
        },
      }),
    }

    // For AccountEntry: use snapshotRouteId for reliable filtering
    // This field is always populated and doesn't depend on nullable relations
    const accountEntryWhere: Prisma.AccountEntryWhereInput = {
      entryDate: dateRange,
      ...(input.routeId && { snapshotRouteId: input.routeId }),
    }

    // For LeadPaymentReceived: filter by createdAt and optionally by lead's routes
    const leadPaymentReceivedWhere: Prisma.LeadPaymentReceivedWhereInput = {
      createdAt: dateRange,
      ...(input.routeId && {
        leadRelation: { routes: { some: { id: input.routeId } } },
      }),
    }

    return { loanWhere, loanPaymentWhere, accountEntryWhere, leadPaymentReceivedWhere }
  }

  /**
   * Validate input parameters
   */
  private validateInput(input: BulkDateMigrationInput): void {
    // Validate date range order
    if (input.startBusinessDate >= input.endBusinessDate) {
      throw new GraphQLError('La fecha de inicio debe ser anterior a la fecha de fin', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    // Safety check: prevent accidental migration of very large date ranges
    const rangeDays = Math.abs(
      (input.endBusinessDate.getTime() - input.startBusinessDate.getTime()) / (1000 * 60 * 60 * 24)
    )
    if (rangeDays > 7) {
      throw new GraphQLError(
        'El rango de fechas no puede ser mayor a 7 días por seguridad. Contacta al administrador si necesitas migrar más datos.',
        {
          extensions: { code: 'BAD_USER_INPUT' },
        }
      )
    }

    // Validate newBusinessDate is not within the source range
    // This prevents confusing scenarios where some records get migrated multiple times
    if (
      input.newBusinessDate >= input.startBusinessDate &&
      input.newBusinessDate <= input.endBusinessDate
    ) {
      throw new GraphQLError(
        'La nueva fecha de negocio no puede estar dentro del rango de fechas origen',
        {
          extensions: { code: 'BAD_USER_INPUT' },
        }
      )
    }

    // Prevent migration to dates too far in the future (likely user error)
    const maxFutureDate = new Date()
    maxFutureDate.setDate(maxFutureDate.getDate() + 30) // 30 days max
    if (input.newBusinessDate > maxFutureDate) {
      throw new GraphQLError(
        'La nueva fecha de negocio no puede ser mayor a 30 días en el futuro',
        {
          extensions: { code: 'BAD_USER_INPUT' },
        }
      )
    }
  }
}
