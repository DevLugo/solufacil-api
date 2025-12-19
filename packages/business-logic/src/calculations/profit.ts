import { Decimal } from 'decimal.js'

/**
 * =============================================================================
 * PROFIT CALCULATION MODULE
 * =============================================================================
 *
 * This module handles all profit-related calculations for loans and payments.
 *
 * KEY BUSINESS RULES:
 * -------------------
 * 1. NEW LOAN - profitAmount = requestedAmount × rate
 *    - profitBase: The base profit calculated from the new loan amount
 *
 * 2. RENEWAL - profitAmount = profitBase + profitHeredado
 *    - profitBase: requestedAmount × rate (same as new loan)
 *    - profitHeredado: The PROFIT PORTION of the pending debt from previous loan
 *    - Formula: profitHeredado = pendingAmountStored × (profitAmount / totalDebtAcquired)
 *    - Only the profit portion is inherited, NOT the full pending debt
 *
 * 3. AMOUNT GIVEN in renewal:
 *    - amountGived = requestedAmount - pendingDebt (full pending debt)
 *    - pendingDebt = profit pending + returnToCapital pending
 *
 * 4. Bad Debt (mala deuda):
 *    - When a loan has badDebtDate set and payment is received after that date
 *    - 100% of the payment goes to profit (returnToCapital = 0)
 *    - This incentivizes collection after bad debt declaration
 *
 * FORMULAS:
 * ---------
 * - profitBase = requestedAmount × rate
 * - profitHeredado = pendingAmountStored × (profitAmount / totalDebtAcquired)
 * - profitAmount (renewal) = profitBase + profitHeredado
 * - totalDebtAcquired = requestedAmount + profitAmount
 * - expectedWeeklyPayment = totalDebtAcquired / weekDuration
 * - Payment profit distribution:
 *   - profitPorPago = (paymentAmount × totalProfit) / totalDebtAcquired
 *   - returnToCapital = paymentAmount - profitPorPago
 *
 * EXAMPLE (New Loan):
 * ------------------
 * - requestedAmount: $3,000
 * - rate: 40% (0.40)
 * - profitAmount: $3,000 × 0.40 = $1,200
 * - totalDebtAcquired: $3,000 + $1,200 = $4,200
 *
 * EXAMPLE (Renewal - 14 weeks loan, renewing at week 10 with 10 payments made):
 * ----------------------------------------------------------------------------
 * Previous loan:
 * - pendingAmountStored: $1,200 (4 payments of $300 remaining)
 * - profitAmount: $1,200, totalDebtAcquired: $4,200
 * - Profit ratio: 1200/4200 = 28.57%
 *
 * New loan (renewal):
 * - requestedAmount: $3,000
 * - rate: 40% (0.40)
 * - profitBase: $3,000 × 0.40 = $1,200
 * - profitHeredado: $1,200 × 0.2857 = $342.86 (profit portion only!)
 * - profitAmount: $1,200 + $342.86 = $1,542.86
 * - amountGived: $3,000 - $1,200 = $1,800 (pending debt deducted)
 * - totalDebtAcquired: $3,000 + $1,542.86 = $4,542.86
 *
 * =============================================================================
 */

/**
 * Calcula el profit (ganancia) de un préstamo
 *
 * @param requestedAmount - Monto solicitado del préstamo
 * @param rate - Tasa de ganancia (ej: 0.40 = 40%)
 * @returns Profit amount
 *
 * @example
 * // Loan of $3,000 with 40% rate
 * calculateProfit(new Decimal(3000), new Decimal(0.40))
 * // Returns: Decimal(1200)
 */
export function calculateProfit(requestedAmount: Decimal, rate: Decimal): Decimal {
  return requestedAmount.times(rate).toDecimalPlaces(2)
}

/**
 * Resultado del cálculo de distribución de profit en un pago
 */
export interface PaymentProfitResult {
  /** Porción del pago que corresponde a ganancia */
  profitAmount: Decimal
  /** Porción del pago que corresponde a retorno de capital */
  returnToCapital: Decimal
}

/**
 * Calcula la distribución proporcional de profit vs retorno a capital en un pago
 *
 * La fórmula es: profitAmount = (paymentAmount × totalProfit) / totalDebtAcquired
 *
 * @param paymentAmount - Monto del pago recibido
 * @param totalProfit - Ganancia total del préstamo (del campo profitAmount del loan)
 * @param totalDebtAcquired - Deuda total adquirida (capital + ganancia)
 * @param isBadDebt - Si el préstamo está en cartera vencida (badDebtDate existe)
 * @returns Objeto con profitAmount y returnToCapital
 *
 * @example
 * // Payment of $420 on a loan with $1,200 profit and $4,200 total debt
 * calculatePaymentProfit(
 *   new Decimal(420),   // paymentAmount
 *   new Decimal(1200),  // totalProfit
 *   new Decimal(4200),  // totalDebtAcquired
 *   false               // not bad debt
 * )
 * // Returns: { profitAmount: 120, returnToCapital: 300 }
 * // Because: 420 × (1200/4200) = 420 × 0.2857 ≈ 120
 *
 * @example
 * // Bad debt - 100% goes to profit
 * calculatePaymentProfit(
 *   new Decimal(420),
 *   new Decimal(1200),
 *   new Decimal(4200),
 *   true  // bad debt!
 * )
 * // Returns: { profitAmount: 420, returnToCapital: 0 }
 */
export function calculatePaymentProfit(
  paymentAmount: Decimal,
  totalProfit: Decimal,
  totalDebtAcquired: Decimal,
  isBadDebt: boolean = false
): PaymentProfitResult {
  // Si es bad debt, todo el pago es ganancia
  // Esto incentiva la cobranza después de declarar mala deuda
  if (isBadDebt) {
    return {
      profitAmount: paymentAmount,
      returnToCapital: new Decimal(0),
    }
  }

  // Evitar división por cero
  if (totalDebtAcquired.isZero()) {
    return {
      profitAmount: new Decimal(0),
      returnToCapital: paymentAmount,
    }
  }

  // Profit proporcional: (paymentAmount × totalProfit) / totalDebtAcquired
  let profitAmount = paymentAmount
    .times(totalProfit)
    .dividedBy(totalDebtAcquired)
    .toDecimalPlaces(2)

  // CRÍTICO: El profit NUNCA puede ser mayor al monto del pago
  // Si pagan $100, el profit máximo son $100
  if (profitAmount.greaterThan(paymentAmount)) {
    profitAmount = paymentAmount
  }

  const returnToCapital = paymentAmount.minus(profitAmount).toDecimalPlaces(2)

  return { profitAmount, returnToCapital }
}

/**
 * Resultado del cálculo de métricas de préstamo
 */
export interface LoanMetricsResult {
  /** Ganancia total del préstamo */
  profitAmount: Decimal
  /** Deuda total (capital + ganancia) */
  totalDebtAcquired: Decimal
  /** Pago semanal esperado */
  expectedWeeklyPayment: Decimal
}

/**
 * Calcula las métricas BASE de un préstamo (nuevo o renovación)
 *
 * IMPORTANTE: Esta función calcula solo el profitBase y totalDebtBase.
 * Para RENOVACIONES, el LoanService agrega el profitHeredado después de
 * llamar a esta función:
 *   - profitHeredado = pendingAmountStored × (profitAmount / totalDebtAcquired)
 *   - finalProfitAmount = profitBase + profitHeredado
 *   - finalTotalDebt = totalDebtBase + profitHeredado
 *
 * @param requestedAmount - Monto solicitado
 * @param rate - Tasa de ganancia (ej: 0.40 = 40%)
 * @param weekDuration - Duración en semanas
 * @returns Objeto con profitAmount (base), totalDebtAcquired (base), expectedWeeklyPayment
 *
 * @example
 * // New loan of $3,000 at 40% for 14 weeks
 * calculateLoanMetrics(
 *   new Decimal(3000),
 *   new Decimal(0.40),
 *   14
 * )
 * // Returns:
 * // {
 * //   profitAmount: 1200,        // profitBase
 * //   totalDebtAcquired: 4200,   // totalDebtBase
 * //   expectedWeeklyPayment: 300
 * // }
 *
 * @example
 * // For renewal, LoanService adds profitHeredado:
 * // If previous loan has $1,200 pending (profitHeredado = $342.86):
 * // finalProfitAmount = 1200 + 342.86 = 1542.86
 * // finalTotalDebt = 4200 + 342.86 = 4542.86
 */
export function calculateLoanMetrics(
  requestedAmount: Decimal,
  rate: Decimal,
  weekDuration: number
): LoanMetricsResult {
  const profitAmount = calculateProfit(requestedAmount, rate)
  const totalDebtAcquired = requestedAmount.plus(profitAmount).toDecimalPlaces(2)
  const expectedWeeklyPayment = totalDebtAcquired
    .dividedBy(weekDuration)
    .toDecimalPlaces(2)

  return {
    profitAmount,
    totalDebtAcquired,
    expectedWeeklyPayment,
  }
}

/**
 * Calcula el monto a entregar en una renovación
 *
 * @param requestedAmount - Monto solicitado por el cliente
 * @param pendingDebt - Deuda pendiente del préstamo anterior
 * @returns Monto a entregar físicamente al cliente
 *
 * @example
 * // Client requests $3,000 but has $1,200 pending
 * calculateAmountToGive(
 *   new Decimal(3000),
 *   new Decimal(1200)
 * )
 * // Returns: Decimal(1800)
 */
export function calculateAmountToGive(
  requestedAmount: Decimal,
  pendingDebt: Decimal
): Decimal {
  const amountGived = requestedAmount.minus(pendingDebt)
  // Never give negative amount
  return amountGived.isNegative() ? new Decimal(0) : amountGived.toDecimalPlaces(2)
}

/**
 * Resultado del cálculo de profit heredado en una renovación
 */
export interface ProfitHeredadoResult {
  /** Profit heredado del préstamo anterior */
  profitHeredado: Decimal
  /** Ratio de profit sobre deuda total (para referencia) */
  profitRatio: Decimal
}

/**
 * Calcula el profit heredado en una renovación de préstamo
 *
 * IMPORTANTE: Solo la PORCIÓN DE PROFIT de la deuda pendiente se hereda,
 * NO la deuda pendiente total.
 *
 * @param pendingAmountStored - Deuda pendiente total del préstamo anterior (profit + returnToCapital)
 * @param previousProfitAmount - Profit total del préstamo anterior
 * @param previousTotalDebt - Deuda total adquirida del préstamo anterior
 * @returns Objeto con profitHeredado y profitRatio
 *
 * @example
 * // Préstamo anterior: $3,000 al 40%, 14 semanas, 10 pagos realizados
 * // profitAmount: $1,200, totalDebtAcquired: $4,200
 * // Deuda pendiente: 4 pagos × $300 = $1,200
 * // Profit ratio: 1200/4200 = 28.57%
 *
 * calculateProfitHeredado(
 *   new Decimal(1200),  // pendingAmountStored
 *   new Decimal(1200),  // previousProfitAmount
 *   new Decimal(4200)   // previousTotalDebt
 * )
 * // Returns: { profitHeredado: 342.86, profitRatio: 0.2857 }
 * // Because: $1,200 × 0.2857 = $342.86
 *
 * @example
 * // Sin pagos realizados (deuda pendiente = deuda total)
 * calculateProfitHeredado(
 *   new Decimal(4200),  // pendingAmountStored = total
 *   new Decimal(1200),  // previousProfitAmount
 *   new Decimal(4200)   // previousTotalDebt
 * )
 * // Returns: { profitHeredado: 1200, profitRatio: 0.2857 }
 * // Because: $4,200 × 0.2857 = $1,200 (todo el profit original)
 */
export function calculateProfitHeredado(
  pendingAmountStored: Decimal,
  previousProfitAmount: Decimal,
  previousTotalDebt: Decimal
): ProfitHeredadoResult {
  // Evitar división por cero
  if (previousTotalDebt.isZero()) {
    return {
      profitHeredado: new Decimal(0),
      profitRatio: new Decimal(0),
    }
  }

  // Calcular el ratio de profit sobre la deuda total
  // profitRatio = profitAmount / totalDebtAcquired
  const profitRatio = previousProfitAmount.dividedBy(previousTotalDebt)

  // Calcular el profit heredado: solo la porción de profit de la deuda pendiente
  // profitHeredado = pendingAmountStored × profitRatio
  const profitHeredado = pendingAmountStored.times(profitRatio).toDecimalPlaces(2)

  return {
    profitHeredado,
    profitRatio: profitRatio.toDecimalPlaces(4),
  }
}

/**
 * Resultado del cálculo completo de métricas para renovación
 */
export interface RenewalMetricsResult {
  /** Profit base del nuevo préstamo (requestedAmount × rate) */
  profitBase: Decimal
  /** Profit heredado del préstamo anterior */
  profitHeredado: Decimal
  /** Profit total (profitBase + profitHeredado) */
  profitTotal: Decimal
  /** Return to capital (= requestedAmount) */
  returnToCapital: Decimal
  /** Deuda total del nuevo préstamo */
  totalDebtAcquired: Decimal
  /** Monto a entregar físicamente al cliente */
  amountGived: Decimal
  /** Pago semanal esperado */
  expectedWeeklyPayment: Decimal
}

/**
 * Calcula todas las métricas para una renovación de préstamo
 *
 * @param requestedAmount - Monto solicitado por el cliente
 * @param rate - Tasa de ganancia (ej: 0.40 = 40%)
 * @param weekDuration - Duración en semanas del nuevo préstamo
 * @param previousLoan - Datos del préstamo anterior para calcular herencia
 * @returns Objeto con todas las métricas de renovación
 *
 * @example
 * // Renovación: Cliente solicita $3,000 al 40%, 14 semanas
 * // Préstamo anterior: deuda pendiente $1,200, profit $1,200, deuda total $4,200
 *
 * calculateRenewalMetrics(
 *   new Decimal(3000),
 *   new Decimal(0.40),
 *   14,
 *   {
 *     pendingAmountStored: new Decimal(1200),
 *     profitAmount: new Decimal(1200),
 *     totalDebtAcquired: new Decimal(4200),
 *   }
 * )
 * // Returns:
 * // {
 * //   profitBase: 1200,
 * //   profitHeredado: 342.86,
 * //   profitTotal: 1542.86,
 * //   returnToCapital: 3000,
 * //   totalDebtAcquired: 4542.86,
 * //   amountGived: 1800,
 * //   expectedWeeklyPayment: 324.49
 * // }
 */
export function calculateRenewalMetrics(
  requestedAmount: Decimal,
  rate: Decimal,
  weekDuration: number,
  previousLoan: {
    pendingAmountStored: Decimal
    profitAmount: Decimal
    totalDebtAcquired: Decimal
  }
): RenewalMetricsResult {
  // 1. Calcular métricas base del nuevo préstamo
  const profitBase = calculateProfit(requestedAmount, rate)

  // 2. Calcular profit heredado del préstamo anterior
  const { profitHeredado } = calculateProfitHeredado(
    previousLoan.pendingAmountStored,
    previousLoan.profitAmount,
    previousLoan.totalDebtAcquired
  )

  // 3. Calcular totales
  const profitTotal = profitBase.plus(profitHeredado).toDecimalPlaces(2)
  const returnToCapital = requestedAmount
  const totalDebtAcquired = returnToCapital.plus(profitTotal).toDecimalPlaces(2)

  // 4. Calcular monto a entregar (deducir deuda pendiente total)
  const amountGived = calculateAmountToGive(requestedAmount, previousLoan.pendingAmountStored)

  // 5. Calcular pago semanal
  const expectedWeeklyPayment = totalDebtAcquired.dividedBy(weekDuration).toDecimalPlaces(2)

  return {
    profitBase,
    profitHeredado,
    profitTotal,
    returnToCapital,
    totalDebtAcquired,
    amountGived,
    expectedWeeklyPayment,
  }
}
