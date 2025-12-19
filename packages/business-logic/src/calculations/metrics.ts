import { Decimal } from 'decimal.js'

/**
 * Calcula el recovery rate (tasa de recuperación) de una cartera
 * @param totalExpected - Total esperado a cobrar
 * @param totalCollected - Total cobrado
 * @returns Recovery rate como porcentaje
 */
export function calculateRecoveryRate(
  totalExpected: Decimal,
  totalCollected: Decimal
): Decimal {
  if (totalExpected.isZero()) {
    return new Decimal(0)
  }
  return totalCollected.dividedBy(totalExpected).times(100).toDecimalPlaces(2)
}

/**
 * Calcula el promedio de ticket (monto promedio de préstamos)
 */
export function calculateAverageTicket(
  totalAmount: Decimal,
  loanCount: number
): Decimal {
  if (loanCount === 0) {
    return new Decimal(0)
  }
  return totalAmount.dividedBy(loanCount).toDecimalPlaces(2)
}
