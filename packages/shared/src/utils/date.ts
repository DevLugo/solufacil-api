/**
 * Formatea una fecha a formato legible en español
 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

/**
 * Obtiene la fecha de inicio de la semana (lunes) según ISO 8601
 * Resetea horas a 00:00:00.000
 */
export function getStartOfWeek(date: Date): Date {
  const d = new Date(date)
  const isoDow = (d.getDay() + 6) % 7 // 0 = Lunes, 6 = Domingo
  d.setDate(d.getDate() - isoDow)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Obtiene la fecha de fin de la semana
 */
export function getEndOfWeek(date: Date): Date {
  const start = getStartOfWeek(date)
  return new Date(start.setDate(start.getDate() + 6))
}

/**
 * Obtiene el número de semana del año
 */
export function getWeekNumber(date: Date): number {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  const yearStart = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/**
 * Calcula la diferencia en días entre dos fechas
 */
export function daysBetween(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000
  return Math.round(Math.abs((date1.getTime() - date2.getTime()) / oneDay))
}

/**
 * Formatea una fecha en formato corto (dd/mm/aaaa)
 * Acepta Date, string o null
 */
export function formatDateShort(date: Date | string | null): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

/**
 * Formatea una fecha en formato muy compacto (dd/mm/aa)
 */
export function formatDateCompact(date: Date): string {
  return date.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  })
}

/**
 * Obtiene el nombre del mes de una fecha
 */
export function getMonthName(date: Date): string {
  return date.toLocaleDateString('es-MX', { month: 'long' })
}

/**
 * Calcula el número de semana dentro del mes
 */
export function getWeekNumberInMonth(date: Date): number {
  const dayOfMonth = date.getDate()
  return Math.ceil(dayOfMonth / 7)
}
