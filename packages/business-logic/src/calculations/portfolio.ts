/**
 * =============================================================================
 * PORTFOLIO CALCULATION MODULE
 * =============================================================================
 *
 * This module handles all calculations related to Portfolio Report metrics:
 * - CV (Cartera Vencida) calculation
 * - Client balance (new vs finished without renewal)
 * - Renovation KPIs
 *
 * KEY BUSINESS RULES:
 * -------------------
 * 1. CV (Cartera Vencida):
 *    - Loan is in CV if NO payment received in the active week
 *    - Client exits CV with 2+ payments in the following week
 *    - CV is CALCULATED, never stored in DB
 *
 * 2. Active Client:
 *    - pendingAmountStored > 0
 *    - badDebtDate = null
 *    - excludedByCleanup = null
 *
 * 3. Client Balance:
 *    - +1: New client (first loan, previousLoan = null)
 *    - -1: Client finished without renewing
 *    - 0: Client renewed (neutral)
 *
 * =============================================================================
 */

import type {
  WeekRange,
  LoanForPortfolio,
  PaymentForCV,
  CVCalculationResult,
  CVStatus,
  ClientBalanceResult,
  RenovationKPIs,
  Trend,
} from '../types/portfolio'
import { isDateInWeek } from './active-week'

/**
 * Determines if a loan is active (eligible for portfolio report)
 *
 * @param loan - Loan data to check
 * @returns true if loan is active
 *
 * @example
 * isActiveLoan({ pendingAmountStored: 1000, badDebtDate: null, excludedByCleanup: null })
 * // Returns: true
 *
 * isActiveLoan({ pendingAmountStored: 0, badDebtDate: null, excludedByCleanup: null })
 * // Returns: false (no pending amount)
 */
export function isActiveLoan(loan: LoanForPortfolio): boolean {
  return (
    loan.pendingAmountStored > 0 &&
    loan.badDebtDate === null &&
    loan.excludedByCleanup === null
  )
}

/**
 * Counts payments within a week range
 *
 * @param payments - Array of payments to check
 * @param weekRange - The week range to check against
 * @returns Number of payments in the week
 */
export function countPaymentsInWeek(
  payments: PaymentForCV[],
  weekRange: WeekRange
): number {
  return payments.filter((payment) =>
    isDateInWeek(payment.receivedAt, weekRange)
  ).length
}

/**
 * Determines if a loan is in Cartera Vencida (CV)
 *
 * A loan is in CV if:
 * 1. It's an active loan
 * 2. It wasn't signed in the current week (new loans get grace)
 * 3. It received NO payments in the active week
 *
 * @param loan - Loan data to check
 * @param payments - Payments for this loan
 * @param activeWeek - The active week range
 * @returns true if loan is in CV
 *
 * @example
 * // Loan with no payments this week
 * isInCarteraVencida(
 *   { pendingAmountStored: 1000, signDate: lastMonth, ... },
 *   [], // no payments
 *   currentWeekRange
 * )
 * // Returns: true
 *
 * @example
 * // Loan signed this week (grace period)
 * isInCarteraVencida(
 *   { pendingAmountStored: 1000, signDate: today, ... },
 *   [],
 *   currentWeekRange
 * )
 * // Returns: false (new loan grace)
 */
export function isInCarteraVencida(
  loan: LoanForPortfolio,
  payments: PaymentForCV[],
  activeWeek: WeekRange
): boolean {
  // Not active = not in CV
  if (!isActiveLoan(loan)) {
    return false
  }

  // Loans signed in the active week get a grace period
  if (isDateInWeek(loan.signDate, activeWeek)) {
    return false
  }

  // Check if there's at least one payment in the active week
  const paymentsInWeek = countPaymentsInWeek(payments, activeWeek)

  return paymentsInWeek === 0
}

/**
 * Determines if a loan exited CV by making 2+ payments in the following week
 *
 * @param payments - Payments for this loan
 * @param previousWeek - The week when the loan was in CV
 * @param currentWeek - The current week to check for exit
 * @returns true if loan exited CV (made 2+ payments in current week)
 *
 * @example
 * // Loan was in CV last week, made 2 payments this week
 * exitedCarteraVencida(
 *   [{ receivedAt: monday }, { receivedAt: tuesday }],
 *   lastWeekRange,
 *   currentWeekRange
 * )
 * // Returns: true
 */
export function exitedCarteraVencida(
  payments: PaymentForCV[],
  previousWeek: WeekRange,
  currentWeek: WeekRange
): boolean {
  // Count payments in previous week (should be 0 if was in CV)
  const paymentsInPreviousWeek = countPaymentsInWeek(payments, previousWeek)

  // Was in CV if no payments in previous week
  if (paymentsInPreviousWeek > 0) {
    return false // Wasn't in CV, so can't "exit"
  }

  // Count payments in current week
  const paymentsInCurrentWeek = countPaymentsInWeek(payments, currentWeek)

  // Exits CV with 2 or more payments
  return paymentsInCurrentWeek >= 2
}

/**
 * Calculates the complete CV status for a loan
 *
 * @param loan - Loan data to check
 * @param payments - All payments for this loan
 * @param activeWeek - The active week range
 * @param previousWeek - The previous week range (for exit calculation)
 * @returns CVCalculationResult with status and details
 */
export function calculateCVStatus(
  loan: LoanForPortfolio,
  payments: PaymentForCV[],
  activeWeek: WeekRange,
  previousWeek: WeekRange | null
): CVCalculationResult {
  // Check exclusions first
  if (loan.badDebtDate !== null) {
    return {
      loanId: loan.id,
      status: 'EXCLUIDO' as CVStatus,
      exclusionReason: 'BAD_DEBT',
      paymentsInWeek: 0,
      exitedCVThisWeek: false,
    }
  }

  if (loan.excludedByCleanup !== null) {
    return {
      loanId: loan.id,
      status: 'EXCLUIDO' as CVStatus,
      exclusionReason: 'CLEANUP',
      paymentsInWeek: 0,
      exitedCVThisWeek: false,
    }
  }

  if (loan.pendingAmountStored <= 0) {
    return {
      loanId: loan.id,
      status: 'EXCLUIDO' as CVStatus,
      exclusionReason: 'NOT_ACTIVE',
      paymentsInWeek: 0,
      exitedCVThisWeek: false,
    }
  }

  const paymentsInWeek = countPaymentsInWeek(payments, activeWeek)
  const inCV = isInCarteraVencida(loan, payments, activeWeek)

  // Check if exited CV this week
  let exitedCVThisWeek = false
  if (previousWeek && !inCV) {
    exitedCVThisWeek = exitedCarteraVencida(payments, previousWeek, activeWeek)
  }

  return {
    loanId: loan.id,
    status: inCV ? 'EN_CV' : 'AL_CORRIENTE',
    paymentsInWeek,
    exitedCVThisWeek,
  }
}

/**
 * Checks if a loan is from a new client (first loan ever)
 *
 * @param loan - Loan to check
 * @returns true if this is the client's first loan
 */
export function isNewClient(loan: LoanForPortfolio): boolean {
  return loan.previousLoan === null
}

/**
 * Checks if a loan represents a client who finished without renewing
 *
 * Uses both renewedDate and status to determine if the loan was renewed.
 * A loan finished without renewal if:
 * - finishedDate is in the period AND
 * - renewedDate is null AND status is NOT 'RENOVATED'
 *
 * @param loan - Loan to check
 * @param periodStart - Start of the period to check
 * @param periodEnd - End of the period to check
 * @returns true if loan finished in period without renewal
 */
export function isFinishedWithoutRenewal(
  loan: LoanForPortfolio,
  periodStart: Date,
  periodEnd: Date
): boolean {
  if (loan.finishedDate === null) {
    return false
  }

  const finishedInPeriod =
    loan.finishedDate >= periodStart && loan.finishedDate <= periodEnd

  // Check both renewedDate and status to determine if it was renewed
  const wasRenewed = loan.renewedDate !== null || loan.status === 'RENOVATED'

  return finishedInPeriod && !wasRenewed
}

/**
 * Checks if a loan represents a renewal in the period
 *
 * Uses renewedDate as primary indicator. If renewedDate is null but
 * status is 'RENOVATED', uses finishedDate as fallback date.
 *
 * @param loan - Loan to check
 * @param periodStart - Start of the period to check
 * @param periodEnd - End of the period to check
 * @returns true if loan was renewed in the period
 */
export function isRenewalInPeriod(
  loan: LoanForPortfolio,
  periodStart: Date,
  periodEnd: Date
): boolean {
  // Primary: use renewedDate if available
  if (loan.renewedDate !== null) {
    return loan.renewedDate >= periodStart && loan.renewedDate <= periodEnd
  }

  // Fallback: if status is RENOVATED but renewedDate is null, use finishedDate
  if (loan.status === 'RENOVATED' && loan.finishedDate !== null) {
    return loan.finishedDate >= periodStart && loan.finishedDate <= periodEnd
  }

  return false
}

/**
 * Checks if a loan is a new client in the period
 *
 * @param loan - Loan to check
 * @param periodStart - Start of the period to check
 * @param periodEnd - End of the period to check
 * @returns true if loan is from a new client signed in the period
 */
export function isNewClientInPeriod(
  loan: LoanForPortfolio,
  periodStart: Date,
  periodEnd: Date
): boolean {
  if (!isNewClient(loan)) {
    return false
  }

  return loan.signDate >= periodStart && loan.signDate <= periodEnd
}

/**
 * Determines trend based on current vs previous value
 *
 * @param current - Current value
 * @param previous - Previous value
 * @returns Trend indicator
 */
export function calculateTrend(current: number, previous: number): Trend {
  if (current > previous) return 'UP'
  if (current < previous) return 'DOWN'
  return 'STABLE'
}

/**
 * Calculates the client balance for a period
 *
 * Balance = New Clients - Clients who finished without renewing
 *
 * @param loans - All loans to analyze
 * @param periodStart - Start of the period
 * @param periodEnd - End of the period
 * @param previousBalance - Optional previous period balance for trend
 * @returns ClientBalanceResult with counts and trend
 *
 * @example
 * calculateClientBalance(loans, startOfMonth, endOfMonth)
 * // Returns: {
 * //   nuevos: 15,
 * //   terminadosSinRenovar: 8,
 * //   renovados: 12,
 * //   balance: 7,  // 15 - 8
 * //   trend: 'UP'
 * // }
 */
export function calculateClientBalance(
  loans: LoanForPortfolio[],
  periodStart: Date,
  periodEnd: Date,
  previousBalance?: number
): ClientBalanceResult {
  let nuevos = 0
  let terminadosSinRenovar = 0
  let renovados = 0

  for (const loan of loans) {
    if (isNewClientInPeriod(loan, periodStart, periodEnd)) {
      nuevos++
    }

    if (isFinishedWithoutRenewal(loan, periodStart, periodEnd)) {
      terminadosSinRenovar++
    }

    if (isRenewalInPeriod(loan, periodStart, periodEnd)) {
      renovados++
    }
  }

  const balance = nuevos - terminadosSinRenovar
  const trend =
    previousBalance !== undefined
      ? calculateTrend(balance, previousBalance)
      : 'STABLE'

  return {
    nuevos,
    terminadosSinRenovar,
    renovados,
    balance,
    trend,
  }
}

/**
 * Calculates renovation KPIs for a period
 *
 * @param loans - All loans to analyze
 * @param periodStart - Start of the period
 * @param periodEnd - End of the period
 * @param previousTasa - Optional previous period tasa for trend
 * @returns RenovationKPIs with counts and rate
 *
 * @example
 * calculateRenovationKPIs(loans, startOfMonth, endOfMonth)
 * // Returns: {
 * //   totalRenovaciones: 20,
 * //   totalCierresSinRenovar: 5,
 * //   tasaRenovacion: 0.8,  // 20 / 25
 * //   tendencia: 'UP'
 * // }
 */
export function calculateRenovationKPIs(
  loans: LoanForPortfolio[],
  periodStart: Date,
  periodEnd: Date,
  previousTasa?: number
): RenovationKPIs {
  let totalRenovaciones = 0
  let totalCierresSinRenovar = 0

  for (const loan of loans) {
    if (isRenewalInPeriod(loan, periodStart, periodEnd)) {
      totalRenovaciones++
    }

    if (isFinishedWithoutRenewal(loan, periodStart, periodEnd)) {
      totalCierresSinRenovar++
    }
  }

  const total = totalRenovaciones + totalCierresSinRenovar
  const tasaRenovacion = total > 0 ? totalRenovaciones / total : 0

  const tendencia =
    previousTasa !== undefined
      ? calculateTrend(tasaRenovacion, previousTasa)
      : 'STABLE'

  return {
    totalRenovaciones,
    totalCierresSinRenovar,
    tasaRenovacion: Math.round(tasaRenovacion * 10000) / 10000, // 4 decimal places
    tendencia,
  }
}

/**
 * Counts active clients and clients in CV from a list of loans
 *
 * @param loans - Loans to analyze
 * @param paymentsMap - Map of loanId to payments
 * @param activeWeek - The active week range
 * @returns Object with counts
 */
export function countClientsStatus(
  loans: LoanForPortfolio[],
  paymentsMap: Map<string, PaymentForCV[]>,
  activeWeek: WeekRange
): { totalActivos: number; enCV: number; alCorriente: number } {
  let totalActivos = 0
  let enCV = 0

  for (const loan of loans) {
    if (!isActiveLoan(loan)) {
      continue
    }

    totalActivos++
    const payments = paymentsMap.get(loan.id) || []

    if (isInCarteraVencida(loan, payments, activeWeek)) {
      enCV++
    }
  }

  return {
    totalActivos,
    enCV,
    alCorriente: totalActivos - enCV,
  }
}
