import { Decimal } from 'decimal.js'

/**
 * Valida que un monto sea positivo
 */
export function validatePositiveAmount(amount: Decimal, fieldName: string): void {
  if (amount.lessThanOrEqualTo(0)) {
    throw new Error(`${fieldName} must be greater than 0`)
  }
}

/**
 * Valida que una fecha sea válida y no futura
 */
export function validatePastDate(date: Date, fieldName: string): void {
  const now = new Date()
  if (date > now) {
    throw new Error(`${fieldName} cannot be in the future`)
  }
}

/**
 * Valida que el monto otorgado no exceda el monto solicitado
 */
export function validateLoanAmounts(
  requestedAmount: Decimal,
  amountGived: Decimal
): void {
  if (amountGived.greaterThan(requestedAmount)) {
    throw new Error('Amount given cannot exceed requested amount')
  }
}
