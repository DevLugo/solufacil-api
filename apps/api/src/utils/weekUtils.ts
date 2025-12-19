/**
 * Utilidades para manejo de semanas en el sistema
 * Las semanas comienzan el lunes y terminan el domingo
 */

/**
 * Obtiene la fecha de inicio de una semana específica
 * @param year Año
 * @param weekNumber Número de semana (1-52/53)
 * @returns Fecha de inicio de la semana (lunes)
 */
export function getWeekStartDate(year: number, weekNumber: number): Date {
  // Primer día del año
  const jan1 = new Date(year, 0, 1)

  // Encontrar el primer lunes del año
  const dayOfWeek = jan1.getDay() // 0 = domingo, 1 = lunes, ...
  // Si es domingo (0): 1 día, si es lunes (1): 0 días, si es martes (2): 6 días, etc.
  const daysToFirstMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek

  // Primera semana completa comienza en el primer lunes
  const firstMonday = new Date(year, 0, 1 + daysToFirstMonday)

  // Calcular inicio de la semana solicitada
  const weekStart = new Date(firstMonday)
  weekStart.setDate(firstMonday.getDate() + (weekNumber - 1) * 7)

  // Setear a las 00:00:00
  weekStart.setHours(0, 0, 0, 0)

  return weekStart
}

/**
 * Obtiene la fecha de fin de una semana específica
 * @param year Año
 * @param weekNumber Número de semana (1-52/53)
 * @returns Fecha de fin de la semana (domingo)
 */
export function getWeekEndDate(year: number, weekNumber: number): Date {
  const weekStart = getWeekStartDate(year, weekNumber)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)

  // Setear a las 23:59:59
  weekEnd.setHours(23, 59, 59, 999)

  return weekEnd
}

/**
 * Obtiene la semana actual
 * @returns Objeto con año y número de semana
 */
export function getCurrentWeek(): { year: number; weekNumber: number } {
  const now = new Date()
  const year = now.getFullYear()

  // Calcular número de semana
  const jan1 = new Date(year, 0, 1)
  const dayOfWeek = jan1.getDay()
  const daysToFirstMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek
  const firstMonday = new Date(year, 0, 1 + daysToFirstMonday)

  // Si estamos antes del primer lunes, estamos en la última semana del año anterior
  if (now < firstMonday) {
    return {
      year: year - 1,
      weekNumber: getWeeksInYear(year - 1)
    }
  }

  // Calcular días desde el primer lunes
  const daysSinceFirstMonday = Math.floor((now.getTime() - firstMonday.getTime()) / (24 * 60 * 60 * 1000))
  const weekNumber = Math.floor(daysSinceFirstMonday / 7) + 1

  // Si el número de semana excede las semanas del año, estamos en la semana 1 del siguiente año
  const weeksInYear = getWeeksInYear(year)
  if (weekNumber > weeksInYear) {
    return {
      year: year + 1,
      weekNumber: 1
    }
  }

  return {
    year,
    weekNumber
  }
}

/**
 * Obtiene el número total de semanas en un año
 * @param year Año
 * @returns Número de semanas (52 o 53)
 */
export function getWeeksInYear(year: number): number {
  // La mayoría de los años tienen 52 semanas
  // Algunos años tienen 53 semanas dependiendo del día que empieza el año

  const jan1 = new Date(year, 0, 1)
  const dec31 = new Date(year, 11, 31)

  // Calcular semana del 31 de diciembre
  const dayOfWeek = jan1.getDay()
  const daysToFirstMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek
  const firstMonday = new Date(year, 0, 1 + daysToFirstMonday)

  const daysSinceFirstMonday = Math.floor((dec31.getTime() - firstMonday.getTime()) / (24 * 60 * 60 * 1000))
  const lastWeekNumber = Math.floor(daysSinceFirstMonday / 7) + 1

  return lastWeekNumber
}

/**
 * Obtiene un array con todas las semanas de un mes específico
 * @param year Año
 * @param month Mes (1-12)
 * @returns Array de números de semana
 */
export function getWeeksInMonth(year: number, month: number): number[] {
  const weeks: number[] = []
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0) // Último día del mes

  // Calcular semana del primer día
  const currentDate = new Date(firstDay)

  while (currentDate <= lastDay) {
    const { weekNumber } = getWeekOfDate(currentDate)

    if (!weeks.includes(weekNumber)) {
      weeks.push(weekNumber)
    }

    // Avanzar al siguiente día
    currentDate.setDate(currentDate.getDate() + 1)
  }

  return weeks.sort((a, b) => a - b)
}

/**
 * Obtiene la semana de una fecha específica
 * @param date Fecha
 * @returns Objeto con año y número de semana
 */
export function getWeekOfDate(date: Date): { year: number; weekNumber: number } {
  const year = date.getFullYear()

  const jan1 = new Date(year, 0, 1)
  const dayOfWeek = jan1.getDay()
  const daysToFirstMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek
  const firstMonday = new Date(year, 0, 1 + daysToFirstMonday)

  // Si la fecha es antes del primer lunes, pertenece al año anterior
  if (date < firstMonday) {
    return {
      year: year - 1,
      weekNumber: getWeeksInYear(year - 1)
    }
  }

  const daysSinceFirstMonday = Math.floor((date.getTime() - firstMonday.getTime()) / (24 * 60 * 60 * 1000))
  const weekNumber = Math.floor(daysSinceFirstMonday / 7) + 1

  // Si el número de semana excede las semanas del año, pertenece al siguiente año
  const weeksInYear = getWeeksInYear(year)
  if (weekNumber > weeksInYear) {
    return {
      year: year + 1,
      weekNumber: 1
    }
  }

  return {
    year,
    weekNumber
  }
}
