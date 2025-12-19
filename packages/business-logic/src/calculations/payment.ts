import { Decimal } from 'decimal.js'

/**
 * Calcula el saldo pendiente de un préstamo
 */
export function calculatePendingAmount(
  totalDebtAcquired: Decimal,
  totalPaid: Decimal
): Decimal {
  const pending = totalDebtAcquired.minus(totalPaid)
  return pending.isNegative() ? new Decimal(0) : pending.toDecimalPlaces(2)
}

/**
 * Verifica si un préstamo está completamente pagado
 */
export function isLoanFullyPaid(
  totalDebtAcquired: Decimal,
  totalPaid: Decimal
): boolean {
  return totalPaid.greaterThanOrEqualTo(totalDebtAcquired)
}

/**
 * Calcula el progreso de pago como porcentaje
 */
export function calculatePaymentProgress(
  totalDebtAcquired: Decimal,
  totalPaid: Decimal
): Decimal {
  if (totalDebtAcquired.isZero()) {
    return new Decimal(0)
  }
  return totalPaid.dividedBy(totalDebtAcquired).times(100).toDecimalPlaces(2)
}
