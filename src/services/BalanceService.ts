import { Decimal } from 'decimal.js'
import type { PrismaClient, AccountEntry, SourceType, AccountEntryType, Prisma } from '@solufacil/database'

/**
 * BalanceService - Centralized ledger and balance management
 *
 * ===============================================================
 * ARCHITECTURE: LEDGER-BASED BALANCE
 * ===============================================================
 *
 * The balance of an account is derived from the sum of AccountEntry records.
 * Each entry represents a single movement of money (credit or debit).
 *
 * Balance = SUM(AccountEntry.amount) for credits
 *         - SUM(AccountEntry.amount) for debits
 *
 * The Account.amount field is a materialized cache that gets updated
 * on each entry creation. It can be reconciled at any time by
 * calling reconcileAccount().
 *
 * ===============================================================
 * USAGE
 * ===============================================================
 *
 * // In a transaction:
 * const balanceService = new BalanceService(prisma)
 *
 * // Record a loan payment received
 * await balanceService.createEntry({
 *   accountId: cashAccountId,
 *   entryType: 'CREDIT',
 *   amount: new Decimal(100),
 *   sourceType: 'LOAN_PAYMENT_CASH',
 *   loanPaymentId: payment.id,
 * }, tx)
 *
 * // Record commission deducted
 * await balanceService.createEntry({
 *   accountId: cashAccountId,
 *   entryType: 'DEBIT',
 *   amount: new Decimal(8),
 *   sourceType: 'PAYMENT_COMMISSION',
 *   loanPaymentId: payment.id,
 * }, tx)
 *
 * ===============================================================
 */

export interface CreateEntryInput {
  accountId: string
  entryType: AccountEntryType
  amount: Decimal | number | string
  sourceType: SourceType
  entryDate?: Date
  description?: string
  loanId?: string
  loanPaymentId?: string
  leadPaymentReceivedId?: string
  destinationAccountId?: string
  profitAmount?: Decimal | number | string
  returnToCapital?: Decimal | number | string
  snapshotLeadId?: string
  snapshotRouteId?: string
}

export interface ReconciliationResult {
  accountId: string
  storedBalance: Decimal
  calculatedBalance: Decimal
  difference: Decimal
  isConsistent: boolean
  entryCount: number
}

export interface GetEntriesOptions {
  from?: Date
  to?: Date
  sourceType?: SourceType | SourceType[]
  loanId?: string
  loanPaymentId?: string
  leadPaymentReceivedId?: string
  limit?: number
  offset?: number
  orderBy?: 'asc' | 'desc'
}

type PrismaTransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export class BalanceService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a ledger entry and update the materialized balance.
   *
   * This is the ONLY way to modify account balances in the system.
   * All other services should use this method instead of directly
   * updating Account.amount.
   *
   * @param input - The entry details
   * @param tx - Optional Prisma transaction client
   * @returns The created AccountEntry
   */
  async createEntry(
    input: CreateEntryInput,
    tx?: PrismaTransactionClient
  ): Promise<AccountEntry> {
    const client = tx || this.prisma
    const amount = new Decimal(input.amount.toString())

    if (amount.isNegative()) {
      throw new Error('Amount must be positive. Use entryType to indicate direction.')
    }

    if (amount.isZero()) {
      throw new Error('Amount cannot be zero.')
    }

    // Calculate the signed amount for balance update
    const signedAmount = input.entryType === 'CREDIT' ? amount : amount.negated()

    // Create the entry
    const entry = await client.accountEntry.create({
      data: {
        accountId: input.accountId,
        amount,
        entryType: input.entryType,
        sourceType: input.sourceType,
        entryDate: input.entryDate || new Date(),
        description: input.description || '',
        loanId: input.loanId,
        loanPaymentId: input.loanPaymentId,
        leadPaymentReceivedId: input.leadPaymentReceivedId,
        destinationAccountId: input.destinationAccountId,
        profitAmount: input.profitAmount ? new Decimal(input.profitAmount.toString()) : undefined,
        returnToCapital: input.returnToCapital ? new Decimal(input.returnToCapital.toString()) : undefined,
        snapshotLeadId: input.snapshotLeadId || '',
        snapshotRouteId: input.snapshotRouteId || '',
      },
    })

    // Update the materialized balance
    await client.account.update({
      where: { id: input.accountId },
      data: {
        amount: { increment: signedAmount },
      },
    })

    return entry
  }

  /**
   * Create a pair of transfer entries (DEBIT from source, CREDIT to destination).
   *
   * This ensures transfers are always balanced.
   */
  async createTransfer(
    input: {
      sourceAccountId: string
      destinationAccountId: string
      amount: Decimal | number | string
      entryDate?: Date
      description?: string
      snapshotLeadId?: string
      snapshotRouteId?: string
      leadPaymentReceivedId?: string
    },
    tx?: PrismaTransactionClient
  ): Promise<{ sourceEntry: AccountEntry; destinationEntry: AccountEntry }> {
    const client = tx || this.prisma
    const amount = new Decimal(input.amount.toString())

    // Debit from source
    const sourceEntry = await this.createEntry(
      {
        accountId: input.sourceAccountId,
        entryType: 'DEBIT',
        amount,
        sourceType: 'TRANSFER_OUT',
        entryDate: input.entryDate,
        description: input.description,
        destinationAccountId: input.destinationAccountId,
        snapshotLeadId: input.snapshotLeadId,
        snapshotRouteId: input.snapshotRouteId,
        leadPaymentReceivedId: input.leadPaymentReceivedId,
      },
      client as PrismaTransactionClient
    )

    // Credit to destination
    const destinationEntry = await this.createEntry(
      {
        accountId: input.destinationAccountId,
        entryType: 'CREDIT',
        amount,
        sourceType: 'TRANSFER_IN',
        entryDate: input.entryDate,
        description: input.description,
        destinationAccountId: input.sourceAccountId, // Link back to source
        snapshotLeadId: input.snapshotLeadId,
        snapshotRouteId: input.snapshotRouteId,
        leadPaymentReceivedId: input.leadPaymentReceivedId,
      },
      client as PrismaTransactionClient
    )

    return { sourceEntry, destinationEntry }
  }

  /**
   * Reverse an existing entry by creating an opposite entry.
   *
   * This is used for corrections, cancellations, and reverts.
   * The original entry is NOT deleted - a new reversal entry is created.
   */
  async reverseEntry(
    entryId: string,
    options?: {
      description?: string
      entryDate?: Date
    },
    tx?: PrismaTransactionClient
  ): Promise<AccountEntry> {
    const client = tx || this.prisma

    const original = await client.accountEntry.findUnique({
      where: { id: entryId },
    })

    if (!original) {
      throw new Error(`Entry ${entryId} not found`)
    }

    // Create opposite entry
    const reversalType: AccountEntryType = original.entryType === 'CREDIT' ? 'DEBIT' : 'CREDIT'

    return this.createEntry(
      {
        accountId: original.accountId,
        entryType: reversalType,
        amount: original.amount,
        sourceType: original.sourceType,
        entryDate: options?.entryDate || new Date(),
        description: options?.description || `Reversal of ${entryId}`,
        loanId: original.loanId || undefined,
        loanPaymentId: original.loanPaymentId || undefined,
        leadPaymentReceivedId: original.leadPaymentReceivedId || undefined,
        destinationAccountId: original.destinationAccountId || undefined,
        snapshotLeadId: original.snapshotLeadId,
      },
      client as PrismaTransactionClient
    )
  }

  /**
   * Delete entries associated with a specific entity.
   *
   * WARNING: This should only be used during cancellation flows.
   * For normal operations, use reverseEntry() instead.
   *
   * This method also updates the materialized balance.
   */
  async deleteEntriesByLoanPayment(
    loanPaymentId: string,
    tx?: PrismaTransactionClient
  ): Promise<{ deletedCount: number; balanceAdjustments: Map<string, Decimal> }> {
    const client = tx || this.prisma

    // Get entries to delete
    const entries = await client.accountEntry.findMany({
      where: { loanPaymentId },
    })

    // Calculate balance adjustments per account
    const adjustments = new Map<string, Decimal>()

    for (const entry of entries) {
      const current = adjustments.get(entry.accountId) || new Decimal(0)
      const signedAmount = entry.entryType === 'CREDIT'
        ? new Decimal(entry.amount.toString()).negated() // Undo credit
        : new Decimal(entry.amount.toString()) // Undo debit
      adjustments.set(entry.accountId, current.plus(signedAmount))
    }

    // Apply balance adjustments
    for (const [accountId, adjustment] of adjustments) {
      await client.account.update({
        where: { id: accountId },
        data: { amount: { increment: adjustment } },
      })
    }

    // Delete entries
    await client.accountEntry.deleteMany({
      where: { loanPaymentId },
    })

    return { deletedCount: entries.length, balanceAdjustments: adjustments }
  }

  /**
   * Delete entries associated with a loan.
   */
  async deleteEntriesByLoan(
    loanId: string,
    tx?: PrismaTransactionClient
  ): Promise<{ deletedCount: number; balanceAdjustments: Map<string, Decimal> }> {
    const client = tx || this.prisma

    // Get entries to delete
    const entries = await client.accountEntry.findMany({
      where: { loanId },
    })

    // Calculate balance adjustments per account
    const adjustments = new Map<string, Decimal>()

    for (const entry of entries) {
      const current = adjustments.get(entry.accountId) || new Decimal(0)
      const signedAmount = entry.entryType === 'CREDIT'
        ? new Decimal(entry.amount.toString()).negated()
        : new Decimal(entry.amount.toString())
      adjustments.set(entry.accountId, current.plus(signedAmount))
    }

    // Apply balance adjustments
    for (const [accountId, adjustment] of adjustments) {
      await client.account.update({
        where: { id: accountId },
        data: { amount: { increment: adjustment } },
      })
    }

    // Delete entries
    await client.accountEntry.deleteMany({
      where: { loanId },
    })

    return { deletedCount: entries.length, balanceAdjustments: adjustments }
  }

  /**
   * Delete entries associated with a LeadPaymentReceived.
   */
  async deleteEntriesByLeadPaymentReceived(
    leadPaymentReceivedId: string,
    tx?: PrismaTransactionClient
  ): Promise<{ deletedCount: number; balanceAdjustments: Map<string, Decimal> }> {
    const client = tx || this.prisma

    // Get entries to delete
    const entries = await client.accountEntry.findMany({
      where: { leadPaymentReceivedId },
    })

    // Calculate balance adjustments per account
    const adjustments = new Map<string, Decimal>()

    for (const entry of entries) {
      const current = adjustments.get(entry.accountId) || new Decimal(0)
      const signedAmount = entry.entryType === 'CREDIT'
        ? new Decimal(entry.amount.toString()).negated() // Undo credit
        : new Decimal(entry.amount.toString()) // Undo debit
      adjustments.set(entry.accountId, current.plus(signedAmount))
    }

    // Apply balance adjustments
    for (const [accountId, adjustment] of adjustments) {
      await client.account.update({
        where: { id: accountId },
        data: { amount: { increment: adjustment } },
      })
    }

    // Delete entries
    await client.accountEntry.deleteMany({
      where: { leadPaymentReceivedId },
    })

    return { deletedCount: entries.length, balanceAdjustments: adjustments }
  }

  /**
   * Reconcile an account by comparing stored balance with calculated balance.
   *
   * This does NOT modify any data - it only reports the current state.
   */
  async reconcileAccount(accountId: string): Promise<ReconciliationResult> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    })

    if (!account) {
      throw new Error(`Account ${accountId} not found`)
    }

    const storedBalance = new Decimal(account.amount.toString())

    // Calculate balance from entries
    const aggregation = await this.prisma.accountEntry.aggregate({
      where: { accountId },
      _count: true,
      _sum: { amount: true },
    })

    // Get credits and debits separately
    const credits = await this.prisma.accountEntry.aggregate({
      where: { accountId, entryType: 'CREDIT' },
      _sum: { amount: true },
    })

    const debits = await this.prisma.accountEntry.aggregate({
      where: { accountId, entryType: 'DEBIT' },
      _sum: { amount: true },
    })

    const totalCredits = new Decimal(credits._sum.amount?.toString() || '0')
    const totalDebits = new Decimal(debits._sum.amount?.toString() || '0')
    const calculatedBalance = totalCredits.minus(totalDebits)

    const difference = storedBalance.minus(calculatedBalance)
    const isConsistent = difference.isZero()

    return {
      accountId,
      storedBalance,
      calculatedBalance,
      difference,
      isConsistent,
      entryCount: aggregation._count,
    }
  }

  /**
   * Fix an inconsistent balance by creating an adjustment entry.
   *
   * This creates an entry to make calculatedBalance match storedBalance.
   * Unlike createEntry, this does NOT update the stored balance since
   * the purpose is to bring entries in sync with the already-correct stored balance.
   *
   * This should only be used after investigation of why the discrepancy exists.
   */
  async fixBalance(
    accountId: string,
    description?: string,
    tx?: PrismaTransactionClient
  ): Promise<AccountEntry | null> {
    const reconciliation = await this.reconcileAccount(accountId)

    if (reconciliation.isConsistent) {
      return null // No fix needed
    }

    const client = tx || this.prisma

    // difference = stored - calculated
    // If positive: stored > calculated, need CREDIT to increase calculated
    // If negative: stored < calculated, need DEBIT to decrease calculated
    const entryType: AccountEntryType = reconciliation.difference.isPositive() ? 'CREDIT' : 'DEBIT'
    const amount = reconciliation.difference.abs()

    // Create the entry WITHOUT updating the stored balance
    // (since we're fixing entries to match stored, not the other way around)
    const entry = await client.accountEntry.create({
      data: {
        accountId,
        amount,
        entryType,
        sourceType: 'BALANCE_ADJUSTMENT',
        entryDate: new Date(),
        description: description || `Balance adjustment: ${reconciliation.difference}`,
      },
    })

    return entry
  }

  /**
   * Get entries for an account with optional filters.
   */
  async getEntries(
    accountId: string,
    options: GetEntriesOptions = {}
  ): Promise<AccountEntry[]> {
    const where: Prisma.AccountEntryWhereInput = { accountId }

    if (options.from || options.to) {
      where.entryDate = {}
      if (options.from) where.entryDate.gte = options.from
      if (options.to) where.entryDate.lte = options.to
    }

    if (options.sourceType) {
      where.sourceType = Array.isArray(options.sourceType)
        ? { in: options.sourceType }
        : options.sourceType
    }

    if (options.loanId) where.loanId = options.loanId
    if (options.loanPaymentId) where.loanPaymentId = options.loanPaymentId
    if (options.leadPaymentReceivedId) where.leadPaymentReceivedId = options.leadPaymentReceivedId

    return this.prisma.accountEntry.findMany({
      where,
      orderBy: { entryDate: options.orderBy || 'desc' },
      take: options.limit,
      skip: options.offset,
    })
  }

  /**
   * Get entries by route for reporting.
   * Filters by loan's lead current routes.
   */
  async getEntriesByRoute(
    routeId: string,
    options: { from?: Date; to?: Date; sourceType?: SourceType | SourceType[] } = {}
  ): Promise<AccountEntry[]> {
    const where: Prisma.AccountEntryWhereInput = {
      loan: {
        leadRelation: {
          routes: {
            some: { id: routeId },
          },
        },
      },
    }

    if (options.from || options.to) {
      where.entryDate = {}
      if (options.from) where.entryDate.gte = options.from
      if (options.to) where.entryDate.lte = options.to
    }

    if (options.sourceType) {
      where.sourceType = Array.isArray(options.sourceType)
        ? { in: options.sourceType }
        : options.sourceType
    }

    return this.prisma.accountEntry.findMany({
      where,
      orderBy: { entryDate: 'desc' },
    })
  }

  /**
   * Calculate total by source type for reporting.
   */
  async getTotalsBySourceType(
    options: {
      accountId?: string
      routeId?: string
      from?: Date
      to?: Date
    }
  ): Promise<Map<SourceType, { credits: Decimal; debits: Decimal; net: Decimal }>> {
    const where: Prisma.AccountEntryWhereInput = {}

    if (options.accountId) where.accountId = options.accountId
    if (options.routeId) {
      where.loan = {
        leadRelation: {
          routes: {
            some: { id: options.routeId },
          },
        },
      }
    }

    if (options.from || options.to) {
      where.entryDate = {}
      if (options.from) where.entryDate.gte = options.from
      if (options.to) where.entryDate.lte = options.to
    }

    const entries = await this.prisma.accountEntry.findMany({ where })

    const totals = new Map<SourceType, { credits: Decimal; debits: Decimal; net: Decimal }>()

    for (const entry of entries) {
      const current = totals.get(entry.sourceType) || {
        credits: new Decimal(0),
        debits: new Decimal(0),
        net: new Decimal(0),
      }

      const amount = new Decimal(entry.amount.toString())

      if (entry.entryType === 'CREDIT') {
        current.credits = current.credits.plus(amount)
        current.net = current.net.plus(amount)
      } else {
        current.debits = current.debits.plus(amount)
        current.net = current.net.minus(amount)
      }

      totals.set(entry.sourceType, current)
    }

    return totals
  }

  /**
   * Get current balance from the materialized field.
   * This is a fast O(1) operation.
   */
  async getBalance(accountId: string): Promise<Decimal> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    })

    if (!account) {
      throw new Error(`Account ${accountId} not found`)
    }

    return new Decimal(account.amount.toString())
  }

  /**
   * Calculate balance from entries.
   * This is slower but provides the authoritative balance.
   */
  async calculateBalanceFromEntries(accountId: string): Promise<Decimal> {
    const credits = await this.prisma.accountEntry.aggregate({
      where: { accountId, entryType: 'CREDIT' },
      _sum: { amount: true },
    })

    const debits = await this.prisma.accountEntry.aggregate({
      where: { accountId, entryType: 'DEBIT' },
      _sum: { amount: true },
    })

    const totalCredits = new Decimal(credits._sum.amount?.toString() || '0')
    const totalDebits = new Decimal(debits._sum.amount?.toString() || '0')

    return totalCredits.minus(totalDebits)
  }
}
