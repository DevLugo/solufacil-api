/**
 * Safely converts Prisma Decimal or any value to a number
 * Handles null, undefined, Decimal objects, strings, and numbers
 */
export function toDecimal(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as { toNumber: () => number }).toNumber()
  }
  if (typeof value === 'string') return parseFloat(value) || 0
  if (typeof value === 'number') return value
  return 0
}

/**
 * Currency format options
 */
export interface CurrencyFormatOptions {
  decimals?: number
  shortPrefix?: boolean
}

/**
 * Formatea un número como moneda en pesos mexicanos
 * Acepta number o string para mayor flexibilidad
 */
export function formatCurrency(
  amount: number | string,
  options: CurrencyFormatOptions = {}
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  const { decimals = 2, shortPrefix = false } = options

  const formatted = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(num || 0)

  return shortPrefix ? formatted.replace('MX$', '$') : formatted
}

/**
 * Formatea moneda sin decimales
 * Útil para PDFs y reportes
 */
export function formatCurrencyWhole(amount: number | string): string {
  return formatCurrency(amount, { decimals: 0, shortPrefix: true })
}

/**
 * Formatea un número con separadores de miles
 */
export function formatNumber(num: number, decimals: number = 2): string {
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num)
}

/**
 * Formatea un número como porcentaje
 */
export function formatPercentage(num: number, decimals: number = 2): string {
  return `${formatNumber(num, decimals)}%`
}
