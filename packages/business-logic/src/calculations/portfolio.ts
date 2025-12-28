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
  LoanRenewalInfo,
} from '../types/portfolio'
import { isDateInWeek } from './active-week'

/**
 * =============================================================================
 * isLoanConsideredOnDate - LÓGICA ORIGINAL DE KEYSTONE
 * =============================================================================
 *
 * Esta función replica EXACTAMENTE la lógica del original para determinar
 * si un préstamo está activo en una fecha específica.
 *
 * Criterios (en orden):
 * 1. Si no tiene signDate → NO activo
 * 2. Si signDate > date → NO activo (firmado después de la fecha)
 * 3. Si finishedDate <= date → NO activo (ya finalizó)
 * 4. Si cleanupDate <= date → NO activo (excluido por cleanup)
 * 5. Si tiene una renovación con signDate <= date → NO activo (ya renovado)
 * 6. Si el monto pendiente real (totalDebt - totalPaid) <= 0 → NO activo
 *
 * @param loan - Préstamo a evaluar
 * @param date - Fecha de referencia (generalmente weekEnd)
 * @param renewalMap - Mapa de renovaciones: loanId -> array de préstamos que lo renuevan
 * @returns true si el préstamo está activo en la fecha dada
 */
export function isLoanConsideredOnDate(
  loan: LoanForPortfolio,
  date: Date,
  renewalMap: Map<string, LoanRenewalInfo[]> = new Map()
): boolean {
  const dateTime = new Date(date).getTime()

  // PUNTO 0: Si no hay signDate, el préstamo no puede estar activo
  if (!loan.signDate) {
    return false
  }

  const signDateTime = new Date(loan.signDate).getTime()
  if (signDateTime > dateTime) {
    return false // Firmado después de la fecha de referencia
  }

  // PUNTO 1: Si ya fue finalizado antes o en la fecha de referencia, NO está activo
  if (loan.finishedDate !== null) {
    const finishedDateTime = new Date(loan.finishedDate).getTime()
    if (finishedDateTime <= dateTime) {
      return false
    }
  }

  // PUNTO 2: Si fue marcado como badDebt antes de la fecha, NO está activo
  // NOTA: El original no selecciona badDebtDate, pero si existe y es <= fecha, excluir
  if (loan.badDebtDate !== null && loan.badDebtDate !== undefined) {
    const badDebtDateTime = new Date(loan.badDebtDate).getTime()
    if (badDebtDateTime <= dateTime) {
      return false
    }
  }

  // PUNTO 3: Si fue marcado como cleanup, NO está activo
  // IMPORTANTE: El original verifica solo si excludedByCleanup existe.
  // Si cleanupDate es null, new Date(null) = epoch (1970), que es <= cualquier fecha moderna
  // Por lo tanto, si excludedByCleanup existe, el préstamo se excluye
  if (loan.excludedByCleanup !== null) {
    // Si hay cleanupDate, verificar por fecha
    if (loan.cleanupDate) {
      const cleanupDateTime = new Date(loan.cleanupDate).getTime()
      if (cleanupDateTime <= dateTime) {
        return false
      }
    } else {
      // Si no hay cleanupDate pero sí excludedByCleanup, excluir siempre
      // (comportamiento del original: new Date(null) = epoch <= any date)
      return false
    }
  }

  // PUNTO 4: Si ya fue renovado (hay un préstamo más nuevo que lo reemplaza), NO está activo
  // IMPORTANTE: El original SOLO verifica renovaciones si el préstamo tiene previousLoan
  // Es decir, solo para préstamos que son renovaciones de otros
  if (loan.previousLoan) {
    const renewals = renewalMap.get(loan.id) || []
    const hasNewerRenewal = renewals.some((renewal) => {
      const renewalSignDateTime = new Date(renewal.signDate).getTime()
      return renewalSignDateTime <= dateTime
    })

    if (hasNewerRenewal) {
      return false
    }
  }

  // PUNTO 5: Calcular el monto pendiente real
  // IMPORTANTE: El original usa defaults de 0 si requestedAmount o rate son null/undefined
  // NO usa fallback a pendingAmountStored
  const rate = loan.rate ?? 0
  const requestedAmount = loan.requestedAmount ?? 0
  const totalDebt = requestedAmount * (1 + rate)
  const totalPaid = loan.totalPaid ?? 0
  const realPendingAmount = Math.max(0, totalDebt - totalPaid)

  return realPendingAmount > 0
}

/**
 * Construye un mapa de renovaciones a partir de una lista de préstamos.
 * El mapa relaciona cada préstamo con los préstamos que lo renuevan.
 *
 * @param loans - Lista de préstamos
 * @returns Mapa de loanId -> array de préstamos que lo renuevan
 */
export function buildRenewalMap(
  loans: LoanForPortfolio[]
): Map<string, LoanRenewalInfo[]> {
  const renewalMap = new Map<string, LoanRenewalInfo[]>()

  for (const loan of loans) {
    if (loan.previousLoan) {
      const existing = renewalMap.get(loan.previousLoan) || []
      existing.push({
        id: loan.id,
        signDate: loan.signDate,
      })
      renewalMap.set(loan.previousLoan, existing)
    }
  }

  return renewalMap
}

/**
 * Determines if a loan is active (eligible for portfolio report)
 *
 * A loan is active if:
 * - Has pending amount > 0
 * - Not marked as bad debt
 * - Not excluded by cleanup
 * - Was not renewed (renewedDate is null)
 *
 * @param loan - Loan data to check
 * @returns true if loan is active
 *
 * @example
 * isActiveLoan({ pendingAmountStored: 1000, badDebtDate: null, excludedByCleanup: null, renewedDate: null })
 * // Returns: true
 *
 * isActiveLoan({ pendingAmountStored: 1000, badDebtDate: null, excludedByCleanup: null, renewedDate: new Date() })
 * // Returns: false (loan was renewed, new loan replaced it)
 */
export function isActiveLoan(loan: LoanForPortfolio): boolean {
  // Renewed loans are NOT active - they were replaced by another loan
  if (loan.renewedDate !== null) {
    return false
  }

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
 * A loan finished without renewal if:
 * - finishedDate is in the period AND
 * - renewedDate is null
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

  // Check renewedDate to determine if it was renewed
  const wasRenewed = loan.renewedDate !== null

  return finishedInPeriod && !wasRenewed
}

/**
 * Checks if a loan represents a renewal in the period
 *
 * Uses renewedDate to determine if it was renewed in the period.
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
  if (loan.renewedDate === null) {
    return false
  }

  return loan.renewedDate >= periodStart && loan.renewedDate <= periodEnd
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
 * Checks if a loan was active during a historical period.
 * Unlike isActiveLoan(), this doesn't check pendingAmountStored (which is current state).
 * Instead, it trusts that the loan was pre-filtered by date criteria.
 *
 * @param loan - Loan to check
 * @param week - The week to check against
 * @returns true if loan was active during this week
 */
export function wasLoanActiveInWeek(
  loan: LoanForPortfolio,
  week: WeekRange
): boolean {
  // Renewed loans are NOT active - they were replaced by another loan
  // If renewedDate is before this week, the loan was not active
  if (loan.renewedDate !== null && loan.renewedDate < week.start) {
    return false
  }

  // Loan must have been signed before or during this week
  if (loan.signDate > week.end) {
    return false
  }

  // Loan must not have finished before this week started
  if (loan.finishedDate !== null && loan.finishedDate < week.start) {
    return false
  }

  // Loan must not have been renewed before this week started
  if (loan.renewedDate !== null && loan.renewedDate < week.start) {
    return false
  }

  // Loan must not have been marked as bad debt before this week started
  if (loan.badDebtDate !== null && loan.badDebtDate < week.start) {
    return false
  }

  // Loan must not have been excluded
  if (loan.excludedByCleanup !== null) {
    return false
  }

  return true
}

/**
 * Determines if a loan was in CV during a historical week.
 * Unlike isInCarteraVencida(), this uses historical active status.
 *
 * @param loan - Loan to check
 * @param payments - Payments for this loan in the week
 * @param week - The week to check
 * @returns true if loan was in CV during this week
 */
export function wasInCarteraVencidaForWeek(
  loan: LoanForPortfolio,
  payments: PaymentForCV[],
  week: WeekRange
): boolean {
  // Must have been active during this week
  if (!wasLoanActiveInWeek(loan, week)) {
    return false
  }

  // Loans signed in this week get a grace period
  if (isDateInWeek(loan.signDate, week)) {
    return false
  }

  // Check if there's at least one payment in the week
  const paymentsInWeek = countPaymentsInWeek(payments, week)

  return paymentsInWeek === 0
}

/**
 * Counts active clients and clients in CV from a list of loans
 *
 * @param loans - Loans to analyze
 * @param paymentsMap - Map of loanId to payments
 * @param activeWeek - The active week range
 * @param isHistorical - If true, uses historical active status instead of current pendingAmountStored
 * @returns Object with counts
 */
/**
 * Checks if a loan was active at a specific date (just before this date).
 * Used to calculate clientesActivosInicio for a period.
 *
 * @param loan - Loan to check
 * @param date - The date to check (loan must have been active just before this date)
 * @returns true if loan was active at this date
 */
export function wasLoanActiveAtDate(
  loan: LoanForPortfolio,
  date: Date
): boolean {
  // Renewed loans are NOT active after their renewal date
  if (loan.renewedDate !== null) {
    const renewedDateTime = new Date(loan.renewedDate).getTime()
    const dateTime = new Date(date).getTime()
    if (renewedDateTime < dateTime) {
      return false
    }
  }

  // Convert to timestamps for reliable comparison (handles Date objects and strings)
  const dateTime = new Date(date).getTime()
  const signDateTime = new Date(loan.signDate).getTime()

  // Loan must have been signed before this date
  if (signDateTime >= dateTime) {
    return false
  }

  // Loan must not have finished before this date
  if (loan.finishedDate !== null) {
    const finishedDateTime = new Date(loan.finishedDate).getTime()
    if (finishedDateTime < dateTime) {
      return false
    }
  }

  // Loan must not have been renewed before this date
  if (loan.renewedDate !== null) {
    const renewedDateTime = new Date(loan.renewedDate).getTime()
    if (renewedDateTime < dateTime) {
      return false
    }
  }

  // Loan must not have been marked as bad debt before this date
  if (loan.badDebtDate !== null) {
    const badDebtDateTime = new Date(loan.badDebtDate).getTime()
    if (badDebtDateTime < dateTime) {
      return false
    }
  }

  // Loan must not have been excluded
  if (loan.excludedByCleanup !== null) {
    return false
  }

  return true
}

/**
 * Counts loans that were active at a specific date.
 * Used to calculate clientesActivosInicio for a period.
 *
 * @param loans - Loans to check
 * @param date - The date to count active loans at
 * @returns Number of active loans at this date
 */
export function countActiveLoansAtDate(
  loans: LoanForPortfolio[],
  date: Date,
  renewalMap?: Map<string, LoanRenewalInfo[]>
): number {
  // Construir mapa de renovaciones si no se proporcionó
  const effectiveRenewalMap = renewalMap || buildRenewalMap(loans)

  let count = 0
  for (const loan of loans) {
    // IMPORTANTE: Usar isLoanConsideredOnDate igual que el original
    if (isLoanConsideredOnDate(loan, date, effectiveRenewalMap)) {
      count++
    }
  }
  return count
}

/**
 * Counts active clients and clients in CV from a list of loans.
 *
 * IMPORTANTE: Esta función usa la lógica ORIGINAL de Keystone:
 * - Para semanas completadas (isHistorical=true): usa isLoanConsideredOnDate con weekEnd
 * - Para la semana actual (isHistorical=false): usa isLoanConsideredOnDate con fecha actual
 *
 * @param loans - Préstamos a analizar
 * @param paymentsMap - Mapa de pagos por préstamo
 * @param activeWeek - Rango de la semana activa
 * @param isHistorical - Si es true, usa weekEnd como fecha de referencia
 * @param renewalMap - Mapa de renovaciones (opcional, se construye si no se proporciona)
 */
export function countClientsStatus(
  loans: LoanForPortfolio[],
  paymentsMap: Map<string, PaymentForCV[]>,
  activeWeek: WeekRange,
  isHistorical = false,
  renewalMap?: Map<string, LoanRenewalInfo[]>
): { totalActivos: number; enCV: number; alCorriente: number } {
  let totalActivos = 0
  let enCV = 0

  // Construir mapa de renovaciones si no se proporcionó
  const effectiveRenewalMap = renewalMap || buildRenewalMap(loans)

  // Fecha de referencia: weekEnd para histórico, ahora para actual
  const referenceDate = isHistorical ? activeWeek.end : new Date()

  for (const loan of loans) {
    // Usar la lógica ORIGINAL de Keystone
    const isActive = isLoanConsideredOnDate(loan, referenceDate, effectiveRenewalMap)

    if (!isActive) {
      continue
    }

    totalActivos++
    const payments = paymentsMap.get(loan.id) || []

    // Verificar si está en CV (sin pagos en la semana y no es préstamo nuevo de esa semana)
    const inCV = isInCarteraVencidaWithDateCheck(loan, payments, activeWeek, referenceDate, effectiveRenewalMap)

    if (inCV) {
      enCV++
    }
  }

  return {
    totalActivos,
    enCV,
    alCorriente: totalActivos - enCV,
  }
}

/**
 * Verifica si un préstamo está en CV, usando la lógica original.
 * Un préstamo está en CV si:
 * - Está activo en la fecha de referencia
 * - No fue firmado en la semana activa (grace period)
 * - No recibió ningún pago en la semana activa
 */
function isInCarteraVencidaWithDateCheck(
  loan: LoanForPortfolio,
  payments: PaymentForCV[],
  activeWeek: WeekRange,
  referenceDate: Date,
  renewalMap: Map<string, LoanRenewalInfo[]>
): boolean {
  // Verificar que está activo en la fecha de referencia
  if (!isLoanConsideredOnDate(loan, referenceDate, renewalMap)) {
    return false
  }

  // Préstamos firmados en la semana activa tienen grace period
  if (isDateInWeek(loan.signDate, activeWeek)) {
    return false
  }

  // En CV si no hay pagos en la semana
  const paymentsInWeek = countPaymentsInWeek(payments, activeWeek)
  return paymentsInWeek === 0
}
