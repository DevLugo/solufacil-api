/**
 * =============================================================================
 * LOAN ENGINE - Single Source of Truth for Loan Business Logic
 * =============================================================================
 *
 * This class encapsulates ALL loan-related business logic for easy replication
 * in other platforms (Flutter, mobile apps, etc.)
 *
 * ARCHITECTURE:
 * - All methods are PURE FUNCTIONS (no side effects)
 * - Input/Output uses simple objects (no Prisma types)
 * - All calculations use Decimal.js for precision
 * - Ready to be converted to Dart/Flutter
 *
 * DATABASE TABLES AFFECTED:
 * -------------------------
 * 1. Loan - Main loan table
 *    - requestedAmount: Amount client requested
 *    - amountGived: Physical money given to client
 *    - profitAmount: Total profit (base + inherited)
 *    - totalDebtAcquired: Total debt (requestedAmount + profitAmount)
 *    - pendingAmountStored: Remaining debt to pay
 *    - expectedWeeklyPayment: Weekly payment amount
 *    - status: ACTIVE | FINISHED | RENOVATED | BAD_DEBT
 *    - previousLoan: Reference to previous loan (for renewals)
 *
 * 2. Payment - Individual payments
 *    - amount: Payment amount
 *    - profitAmount: Portion that goes to profit
 *    - returnToCapital: Portion that goes to capital return
 *    - loanId: Reference to loan
 *
 * 3. Account - Balance accounts
 *    - balance: Current balance (affected by transactions)
 *
 * 4. Transaction - Money movements
 *    - amount: Transaction amount
 *    - type: INCOME | EXPENSE | TRANSFER
 *    - sourceAccountId / destinationAccountId
 *
 * =============================================================================
 */

import { Decimal } from 'decimal.js'

// ============================================================================
// TYPES - Simple interfaces for cross-platform compatibility
// ============================================================================

/**
 * Input for creating a new loan
 */
export interface CreateLoanInput {
  /** Amount requested by client (e.g., 3000) */
  requestedAmount: number
  /** Interest rate as decimal (e.g., 0.40 for 40%) */
  rate: number
  /** Loan duration in weeks (e.g., 14) */
  weekDuration: number
  /** Optional: Previous loan ID for renewals */
  previousLoanId?: string
}

/**
 * Previous loan data needed for renewal calculations
 */
export interface PreviousLoanData {
  /** Total debt remaining (profit + returnToCapital) */
  pendingAmountStored: number
  /** Original profit amount of the loan */
  profitAmount: number
  /** Original total debt (requestedAmount + profitAmount) */
  totalDebtAcquired: number
}

/**
 * Result of creating a new loan
 */
export interface LoanResult {
  /** Amount requested by client */
  requestedAmount: number
  /** Physical money given to client (requestedAmount - pendingDebt for renewals) */
  amountGived: number
  /** Base profit from new loan (requestedAmount × rate) */
  profitBase: number
  /** Inherited profit from previous loan (only for renewals) */
  profitHeredado: number
  /** Total profit (profitBase + profitHeredado) */
  profitAmount: number
  /** Return to capital (= requestedAmount) */
  returnToCapital: number
  /** Total debt (requestedAmount + profitAmount) */
  totalDebtAcquired: number
  /** Initial pending amount (= totalDebtAcquired) */
  pendingAmountStored: number
  /** Expected weekly payment */
  expectedWeeklyPayment: number
  /** Profit ratio for payment distribution */
  profitRatio: number
}

/**
 * Input for processing a payment
 */
export interface PaymentInput {
  /** Payment amount */
  amount: number
  /** Loan's total profit */
  loanProfitAmount: number
  /** Loan's total debt */
  loanTotalDebt: number
  /** Current pending amount on the loan */
  loanPendingAmount: number
  /** Whether the loan is in bad debt status */
  isBadDebt?: boolean
}

/**
 * Result of processing a payment
 */
export interface PaymentResult {
  /** Payment amount */
  amount: number
  /** Portion that goes to profit */
  profitAmount: number
  /** Portion that returns to capital */
  returnToCapital: number
  /** New pending amount after payment */
  newPendingAmount: number
  /** Whether loan is fully paid */
  isFullyPaid: boolean
}

// ============================================================================
// CANCELLATION TYPES
// ============================================================================

/**
 * Payment data for cancellation analysis
 */
export interface CancelLoanPayment {
  /** Payment amount */
  amount: number
  /** Date when payment was received (ISO string or Date) */
  receivedAt: Date | string
}

/**
 * Input for canceling a loan
 */
export interface CancelLoanInput {
  /** Amount physically given to client */
  amountGived: number
  /** Commission charged on loan grant */
  comissionAmount: number
  /** Date when loan was signed (ISO string or Date) */
  signDate: Date | string
  /** List of payments made on this loan */
  payments: CancelLoanPayment[]
}

/**
 * Result of canceling a loan
 */
export interface CancelLoanResult {
  /** Amount to restore to account */
  amountToRestore: number
  /** Whether there are payments that won't be refunded */
  hasUnaffectedPayments: boolean
  /** Number of payments not refunded */
  unaffectedPaymentsCount: number
  /** Total amount of payments not refunded */
  unaffectedPaymentsAmount: number
  /** Whether first payment (same day) was deducted */
  firstPaymentDeducted: boolean
  /** Amount of first payment deducted (if any) */
  firstPaymentAmount: number
}

// ============================================================================
// LOAN ENGINE CLASS
// ============================================================================

/**
 * LoanEngine - Centralized business logic for loans
 *
 * @example
 * // Create a new loan
 * const loan = LoanEngine.createLoan({
 *   requestedAmount: 3000,
 *   rate: 0.40,
 *   weekDuration: 14
 * })
 *
 * @example
 * // Create a renewal
 * const renewal = LoanEngine.createLoan(
 *   { requestedAmount: 3000, rate: 0.40, weekDuration: 14 },
 *   { pendingAmountStored: 1200, profitAmount: 1200, totalDebtAcquired: 4200 }
 * )
 *
 * @example
 * // Process a payment
 * const payment = LoanEngine.processPayment({
 *   amount: 300,
 *   loanProfitAmount: 1200,
 *   loanTotalDebt: 4200,
 *   loanPendingAmount: 4200
 * })
 */
export class LoanEngine {
  // ==========================================================================
  // LOAN CREATION
  // ==========================================================================

  /**
   * Create a new loan or renewal
   *
   * BUSINESS RULES:
   * 1. profitBase = requestedAmount × rate
   * 2. For renewals: profitHeredado = pendingDebt × (profit / totalDebt)
   * 3. profitAmount = profitBase + profitHeredado
   * 4. totalDebtAcquired = requestedAmount + profitAmount
   * 5. amountGived = requestedAmount - pendingDebt (for renewals)
   *
   * DATABASE CHANGES:
   * - INSERT into Loan table
   * - If renewal: UPDATE previous loan status to 'RENOVATED'
   * - INSERT Transaction (EXPENSE from cash account)
   * - UPDATE Account balance (subtract amountGived)
   *
   * @param input - Loan parameters
   * @param previousLoan - Previous loan data (only for renewals)
   * @returns Complete loan calculation result
   */
  static createLoan(input: CreateLoanInput, previousLoan?: PreviousLoanData): LoanResult {
    const requestedAmount = new Decimal(input.requestedAmount)
    const rate = new Decimal(input.rate)

    // Step 1: Calculate base profit
    const profitBase = requestedAmount.times(rate).toDecimalPlaces(2)

    // Step 2: Calculate inherited profit (only for renewals)
    let profitHeredado = new Decimal(0)
    let pendingDebt = new Decimal(0)

    if (previousLoan) {
      const prevPending = new Decimal(previousLoan.pendingAmountStored)
      const prevProfit = new Decimal(previousLoan.profitAmount)
      const prevTotalDebt = new Decimal(previousLoan.totalDebtAcquired)

      // Calculate profit ratio: profit / totalDebt
      // This tells us what percentage of each peso is profit
      const profitRatio = prevTotalDebt.isZero()
        ? new Decimal(0)
        : prevProfit.dividedBy(prevTotalDebt)

      // Inherited profit = pending debt × profit ratio
      // We only inherit the PROFIT portion, not the full debt
      profitHeredado = prevPending.times(profitRatio).toDecimalPlaces(2)
      pendingDebt = prevPending
    }

    // Step 3: Calculate totals
    const profitAmount = profitBase.plus(profitHeredado).toDecimalPlaces(2)
    const returnToCapital = requestedAmount
    const totalDebtAcquired = returnToCapital.plus(profitAmount).toDecimalPlaces(2)

    // Step 4: Calculate amount to give physically
    // For new loans: full amount
    // For renewals: subtract pending debt
    let amountGived = requestedAmount.minus(pendingDebt)
    if (amountGived.isNegative()) {
      amountGived = new Decimal(0)
    }

    // Step 5: Calculate weekly payment
    const expectedWeeklyPayment = totalDebtAcquired
      .dividedBy(input.weekDuration)
      .toDecimalPlaces(2)

    // Step 6: Calculate profit ratio for future payment distribution
    const profitRatio = totalDebtAcquired.isZero()
      ? 0
      : profitAmount.dividedBy(totalDebtAcquired).toDecimalPlaces(4).toNumber()

    return {
      requestedAmount: requestedAmount.toNumber(),
      amountGived: amountGived.toDecimalPlaces(2).toNumber(),
      profitBase: profitBase.toNumber(),
      profitHeredado: profitHeredado.toNumber(),
      profitAmount: profitAmount.toNumber(),
      returnToCapital: returnToCapital.toNumber(),
      totalDebtAcquired: totalDebtAcquired.toNumber(),
      pendingAmountStored: totalDebtAcquired.toNumber(),
      expectedWeeklyPayment: expectedWeeklyPayment.toNumber(),
      profitRatio,
    }
  }

  // ==========================================================================
  // PAYMENT PROCESSING
  // ==========================================================================

  /**
   * Process a payment on a loan
   *
   * BUSINESS RULES:
   * 1. Each payment is split proportionally between profit and returnToCapital
   * 2. profitPortion = payment × (loanProfit / loanTotalDebt)
   * 3. returnToCapital = payment - profitPortion
   * 4. CRITICAL: profit can NEVER exceed the payment amount
   * 5. For bad debt: 100% goes to profit (incentivizes collection)
   *
   * DATABASE CHANGES:
   * - INSERT into Payment table
   * - UPDATE Loan.pendingAmountStored (subtract payment)
   * - UPDATE Loan.status to 'FINISHED' if fully paid
   * - INSERT Transaction (INCOME to cash account)
   * - UPDATE Account balance (add payment amount)
   *
   * @param input - Payment parameters
   * @returns Payment distribution result
   */
  static processPayment(input: PaymentInput): PaymentResult {
    const payment = new Decimal(input.amount)
    const loanProfit = new Decimal(input.loanProfitAmount)
    const loanTotalDebt = new Decimal(input.loanTotalDebt)
    const pendingAmount = new Decimal(input.loanPendingAmount)

    let profitAmount: Decimal
    let returnToCapital: Decimal

    // Bad debt: 100% goes to profit
    if (input.isBadDebt) {
      profitAmount = payment
      returnToCapital = new Decimal(0)
    } else if (loanTotalDebt.isZero()) {
      // Edge case: avoid division by zero
      profitAmount = new Decimal(0)
      returnToCapital = payment
    } else {
      // Normal case: proportional distribution
      // profitPortion = payment × (loanProfit / loanTotalDebt)
      profitAmount = payment
        .times(loanProfit)
        .dividedBy(loanTotalDebt)
        .toDecimalPlaces(2)

      // CRITICAL: profit can NEVER exceed the payment amount
      // This protects against corrupt data where loanProfit > loanTotalDebt
      if (profitAmount.greaterThan(payment)) {
        profitAmount = payment
      }

      returnToCapital = payment.minus(profitAmount).toDecimalPlaces(2)
    }

    // Calculate new pending amount
    const newPendingAmount = pendingAmount.minus(payment)
    const finalPending = newPendingAmount.isNegative()
      ? new Decimal(0)
      : newPendingAmount.toDecimalPlaces(2)

    return {
      amount: payment.toNumber(),
      profitAmount: profitAmount.toNumber(),
      returnToCapital: returnToCapital.toNumber(),
      newPendingAmount: finalPending.toNumber(),
      isFullyPaid: finalPending.isZero() || finalPending.lessThanOrEqualTo(0.01),
    }
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Calculate profit ratio for a loan
   *
   * @param profitAmount - Total profit of the loan
   * @param totalDebt - Total debt of the loan
   * @returns Profit ratio (0 to 1)
   */
  static calculateProfitRatio(profitAmount: number, totalDebt: number): number {
    if (totalDebt === 0) return 0
    return new Decimal(profitAmount)
      .dividedBy(new Decimal(totalDebt))
      .toDecimalPlaces(4)
      .toNumber()
  }

  /**
   * Calculate expected payment distribution for any amount
   *
   * @param paymentAmount - Amount to analyze
   * @param profitRatio - Loan's profit ratio
   * @returns { profit, returnToCapital }
   */
  static calculatePaymentDistribution(
    paymentAmount: number,
    profitRatio: number
  ): { profit: number; returnToCapital: number } {
    const payment = new Decimal(paymentAmount)
    const ratio = new Decimal(profitRatio)

    const profit = payment.times(ratio).toDecimalPlaces(2).toNumber()
    const returnToCapital = new Decimal(paymentAmount).minus(profit).toDecimalPlaces(2).toNumber()

    return { profit, returnToCapital }
  }

  /**
   * Calculate inherited profit for a potential renewal
   *
   * Use this to preview what would happen if a loan is renewed
   *
   * @param pendingAmount - Current pending debt
   * @param loanProfitAmount - Loan's total profit
   * @param loanTotalDebt - Loan's total debt
   * @returns Inherited profit amount
   */
  static calculateProfitHeredado(
    pendingAmount: number,
    loanProfitAmount: number,
    loanTotalDebt: number
  ): number {
    if (loanTotalDebt === 0) return 0

    const pending = new Decimal(pendingAmount)
    const profit = new Decimal(loanProfitAmount)
    const totalDebt = new Decimal(loanTotalDebt)

    const profitRatio = profit.dividedBy(totalDebt)
    return pending.times(profitRatio).toDecimalPlaces(2).toNumber()
  }

  /**
   * Get loan status based on pending amount
   *
   * @param pendingAmount - Current pending debt
   * @param badDebtDate - Date when marked as bad debt (if any)
   * @returns Loan status
   */
  static getLoanStatus(
    pendingAmount: number,
    badDebtDate?: Date | null
  ): 'ACTIVE' | 'FINISHED' | 'BAD_DEBT' {
    if (pendingAmount <= 0.01) return 'FINISHED'
    if (badDebtDate) return 'BAD_DEBT'
    return 'ACTIVE'
  }

  // ==========================================================================
  // LOAN CANCELLATION
  // ==========================================================================

  /**
   * Calculate cancellation result for a loan
   *
   * BUSINESS RULES:
   * 1. Base restore amount = amountGived + comissionAmount
   * 2. If there's exactly 1 payment AND it was made on the same day as signDate:
   *    - It's considered a "first payment" (advance payment)
   *    - This payment IS refunded (deducted from restore amount)
   * 3. If there are 2+ payments OR payment is from a different day:
   *    - These payments are NOT refunded
   *    - Admin must manually adjust if needed
   *    - Alert is shown to user
   *
   * DATABASE CHANGES (to be done by caller):
   * 1. DELETE all Payment records for this loan
   * 2. DELETE all Transaction records for payments
   * 3. DELETE Transaction records for loan (LOAN_GRANTED, LOAN_GRANTED_COMISSION)
   * 4. INSERT Transaction (INCOME: LOAN_CANCELLED_RESTORE)
   * 5. UPDATE Account balance (add amountToRestore)
   * 6. If renewal: UPDATE previous loan (renewedDate = null)
   * 7. DELETE Loan record
   *
   * @param input - Cancellation input data
   * @returns Cancellation calculation result
   *
   * @example
   * // Loan with no payments
   * const result = LoanEngine.cancelLoan({
   *   amountGived: 3000,
   *   comissionAmount: 50,
   *   signDate: '2024-01-15',
   *   payments: []
   * })
   * // Result: { amountToRestore: 3050, hasUnaffectedPayments: false, ... }
   *
   * @example
   * // Loan with first payment same day (advance payment)
   * const result = LoanEngine.cancelLoan({
   *   amountGived: 3000,
   *   comissionAmount: 50,
   *   signDate: '2024-01-15',
   *   payments: [{ amount: 300, receivedAt: '2024-01-15' }]
   * })
   * // Result: { amountToRestore: 2750, firstPaymentDeducted: true, ... }
   *
   * @example
   * // Loan with payments from other days
   * const result = LoanEngine.cancelLoan({
   *   amountGived: 3000,
   *   comissionAmount: 50,
   *   signDate: '2024-01-15',
   *   payments: [
   *     { amount: 300, receivedAt: '2024-01-22' },
   *     { amount: 300, receivedAt: '2024-01-29' }
   *   ]
   * })
   * // Result: { amountToRestore: 3050, hasUnaffectedPayments: true, unaffectedPaymentsCount: 2, ... }
   */
  static cancelLoan(input: CancelLoanInput): CancelLoanResult {
    const amountGived = new Decimal(input.amountGived)
    const comissionAmount = new Decimal(input.comissionAmount || 0)

    // Base amount to restore
    let amountToRestore = amountGived.plus(comissionAmount)

    // Normalize sign date to YYYY-MM-DD string
    const signDate = new Date(input.signDate)
    const signDateStr = LoanEngine.toDateString(signDate)

    // Initialize result values
    let hasUnaffectedPayments = false
    let unaffectedPaymentsCount = 0
    let unaffectedPaymentsAmount = new Decimal(0)
    let firstPaymentDeducted = false
    let firstPaymentAmount = new Decimal(0)

    const payments = input.payments || []

    if (payments.length === 1) {
      // Single payment - check if it's from the same day (first payment)
      const paymentDate = new Date(payments[0].receivedAt)
      const paymentDateStr = LoanEngine.toDateString(paymentDate)

      if (signDateStr === paymentDateStr) {
        // First payment (advance) - deduct from restore amount
        firstPaymentDeducted = true
        firstPaymentAmount = new Decimal(payments[0].amount)
        amountToRestore = amountToRestore.minus(firstPaymentAmount)

        // Ensure we don't restore negative amount
        if (amountToRestore.isNegative()) {
          amountToRestore = new Decimal(0)
        }
      } else {
        // Payment from different day - not refunded
        hasUnaffectedPayments = true
        unaffectedPaymentsCount = 1
        unaffectedPaymentsAmount = new Decimal(payments[0].amount)
      }
    } else if (payments.length > 1) {
      // Multiple payments - none are refunded
      hasUnaffectedPayments = true
      unaffectedPaymentsCount = payments.length

      for (const payment of payments) {
        unaffectedPaymentsAmount = unaffectedPaymentsAmount.plus(
          new Decimal(payment.amount)
        )
      }
    }

    return {
      amountToRestore: amountToRestore.toDecimalPlaces(2).toNumber(),
      hasUnaffectedPayments,
      unaffectedPaymentsCount,
      unaffectedPaymentsAmount: unaffectedPaymentsAmount.toDecimalPlaces(2).toNumber(),
      firstPaymentDeducted,
      firstPaymentAmount: firstPaymentAmount.toDecimalPlaces(2).toNumber(),
    }
  }

  /**
   * Convert a Date to YYYY-MM-DD string for comparison
   * @private
   */
  private static toDateString(date: Date): string {
    return date.toISOString().split('T')[0]
  }
}

// ============================================================================
// DOCUMENTATION: Complete Flow Examples
// ============================================================================

/**
 * EXAMPLE 1: New Loan Flow
 * ========================
 *
 * Client requests $3,000 at 40% for 14 weeks
 *
 * ```typescript
 * const loan = LoanEngine.createLoan({
 *   requestedAmount: 3000,
 *   rate: 0.40,
 *   weekDuration: 14
 * })
 *
 * // Result:
 * // {
 * //   requestedAmount: 3000,
 * //   amountGived: 3000,         // Full amount (new loan)
 * //   profitBase: 1200,          // 3000 × 0.40
 * //   profitHeredado: 0,         // No previous loan
 * //   profitAmount: 1200,        // profitBase + profitHeredado
 * //   returnToCapital: 3000,
 * //   totalDebtAcquired: 4200,   // 3000 + 1200
 * //   pendingAmountStored: 4200,
 * //   expectedWeeklyPayment: 300,// 4200 / 14
 * //   profitRatio: 0.2857        // 1200 / 4200
 * // }
 * ```
 *
 * DATABASE OPERATIONS:
 * 1. INSERT Loan with all calculated values
 * 2. INSERT Transaction (EXPENSE, amount: 3000)
 * 3. UPDATE Account (subtract 3000 from balance)
 */

/**
 * EXAMPLE 2: Renewal Flow (10 payments made of 14)
 * ================================================
 *
 * Previous loan: $3,000 at 40%, 14 weeks
 * - 10 payments of $300 made = $3,000 paid
 * - pendingAmountStored: $1,200 (4 payments remaining)
 * - profitAmount: $1,200, totalDebtAcquired: $4,200
 *
 * ```typescript
 * const renewal = LoanEngine.createLoan(
 *   {
 *     requestedAmount: 3000,
 *     rate: 0.40,
 *     weekDuration: 14
 *   },
 *   {
 *     pendingAmountStored: 1200,  // 4 × $300
 *     profitAmount: 1200,
 *     totalDebtAcquired: 4200
 *   }
 * )
 *
 * // Result:
 * // {
 * //   requestedAmount: 3000,
 * //   amountGived: 1800,         // 3000 - 1200 (pending debt deducted)
 * //   profitBase: 1200,          // 3000 × 0.40
 * //   profitHeredado: 342.86,    // 1200 × (1200/4200) = 1200 × 0.2857
 * //   profitAmount: 1542.86,     // 1200 + 342.86
 * //   returnToCapital: 3000,
 * //   totalDebtAcquired: 4542.86,// 3000 + 1542.86
 * //   pendingAmountStored: 4542.86,
 * //   expectedWeeklyPayment: 324.49,
 * //   profitRatio: 0.3396
 * // }
 * ```
 *
 * DATABASE OPERATIONS:
 * 1. UPDATE previous Loan: status = 'RENOVATED', finishedDate = now
 * 2. INSERT new Loan with previousLoan reference
 * 3. INSERT Transaction (EXPENSE, amount: 1800)
 * 4. UPDATE Account (subtract 1800 from balance)
 */

/**
 * EXAMPLE 3: Payment Flow
 * =======================
 *
 * Loan: $3,000 at 40%, profitAmount: $1,200, totalDebt: $4,200
 * Payment: $300
 *
 * ```typescript
 * const payment = LoanEngine.processPayment({
 *   amount: 300,
 *   loanProfitAmount: 1200,
 *   loanTotalDebt: 4200,
 *   loanPendingAmount: 4200
 * })
 *
 * // Result:
 * // {
 * //   amount: 300,
 * //   profitAmount: 85.71,       // 300 × (1200/4200) = 300 × 0.2857
 * //   returnToCapital: 214.29,   // 300 - 85.71
 * //   newPendingAmount: 3900,    // 4200 - 300
 * //   isFullyPaid: false
 * // }
 * ```
 *
 * DATABASE OPERATIONS:
 * 1. INSERT Payment with profitAmount and returnToCapital
 * 2. UPDATE Loan: pendingAmountStored = newPendingAmount
 * 3. INSERT Transaction (INCOME, amount: 300)
 * 4. UPDATE Account (add 300 to balance)
 * 5. If isFullyPaid: UPDATE Loan: status = 'FINISHED', finishedDate = now
 */

/**
 * EXAMPLE 4: Bad Debt Payment
 * ===========================
 *
 * When a loan is marked as bad debt, 100% of payments go to profit
 *
 * ```typescript
 * const payment = LoanEngine.processPayment({
 *   amount: 300,
 *   loanProfitAmount: 1200,
 *   loanTotalDebt: 4200,
 *   loanPendingAmount: 1000,
 *   isBadDebt: true
 * })
 *
 * // Result:
 * // {
 * //   amount: 300,
 * //   profitAmount: 300,        // 100% to profit!
 * //   returnToCapital: 0,       // Nothing to capital
 * //   newPendingAmount: 700,
 * //   isFullyPaid: false
 * // }
 * ```
 */

export default LoanEngine
