/**
 * =============================================================================
 * ACTIVE WEEK CALCULATION MODULE
 * =============================================================================
 *
 * This module handles all calculations related to "Semana Activa" (Active Week)
 * for the Portfolio Report system.
 *
 * KEY BUSINESS RULES:
 * -------------------
 * 1. WEEK DEFINITION: Monday 00:00:00 to Sunday 23:59:59
 *    - NOT the ISO standard (which starts on Sunday)
 *
 * 2. WEEK-TO-MONTH ASSIGNMENT: Based on weekdays (Mon-Fri) count
 *    - A week belongs to the month with MORE weekdays (L-V)
 *    - Example: If Mon-Tue are in June, Wed-Fri in July → Week belongs to JULY
 *
 * 3. WEEK NUMBER: ISO week number adjusted for Monday start
 *
 * FORMULAS:
 * ---------
 * - Week Start = Monday 00:00:00 of the week containing the date
 * - Week End = Sunday 23:59:59 of the same week
 * - Week belongs to month = max(weekdays in month A, weekdays in month B)
 *
 * =============================================================================
 */

import type { WeekRange, WeekMonthAssignment } from '../types/portfolio'

/**
 * Gets the start of the active week (Monday 00:00:00) for a given date
 *
 * @param date - Any date within the desired week
 * @returns Date object set to Monday 00:00:00 of that week
 *
 * @example
 * // Wednesday Dec 11, 2024
 * getWeekStart(new Date('2024-12-11'))
 * // Returns: Mon Dec 9, 2024 00:00:00
 *
 * @example
 * // Sunday Dec 15, 2024
 * getWeekStart(new Date('2024-12-15'))
 * // Returns: Mon Dec 9, 2024 00:00:00
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay() // 0=Sunday, 1=Monday, ..., 6=Saturday

  // Calculate difference to Monday
  // If Sunday (0), go back 6 days
  // Otherwise, go back (day - 1) days
  const diff = day === 0 ? -6 : 1 - day

  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)

  return d
}

/**
 * Gets the end of the active week (Sunday 23:59:59.999) for a given week start
 *
 * @param weekStart - The Monday 00:00:00 of the week
 * @returns Date object set to Sunday 23:59:59.999 of that week
 *
 * @example
 * // Monday Dec 9, 2024 00:00:00
 * getWeekEnd(new Date('2024-12-09'))
 * // Returns: Sun Dec 15, 2024 23:59:59.999
 */
export function getWeekEnd(weekStart: Date): Date {
  const d = new Date(weekStart)
  d.setDate(d.getDate() + 6) // Add 6 days to get to Sunday
  d.setHours(23, 59, 59, 999)
  return d
}

/**
 * Gets the ISO week number for a date
 * Week 1 is the week containing January 4th
 *
 * @param date - The date to get the week number for
 * @returns Week number (1-53)
 */
export function getISOWeekNumber(date: Date): number {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)

  // Set to nearest Thursday (current date + 4 - current day number)
  // Make Sunday's day number 7
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))

  // Get first day of year
  const yearStart = new Date(d.getFullYear(), 0, 1)

  // Calculate full weeks to nearest Thursday
  const weekNumber = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  )

  return weekNumber
}

/**
 * Gets the complete active week range for a given date
 *
 * @param date - Any date within the desired week
 * @returns WeekRange object with start, end, weekNumber, and year
 *
 * @example
 * getActiveWeekRange(new Date('2024-12-11'))
 * // Returns: {
 * //   start: Mon Dec 9, 2024 00:00:00,
 * //   end: Sun Dec 15, 2024 23:59:59.999,
 * //   weekNumber: 50,
 * //   year: 2024
 * // }
 */
export function getActiveWeekRange(date: Date): WeekRange {
  const start = getWeekStart(date)
  const end = getWeekEnd(start)
  const weekNumber = getISOWeekNumber(start)

  // Year is based on week assignment, not start date
  // A week at year boundary may belong to different year
  const { year } = getWeekBelongsToMonth(start)

  return { start, end, weekNumber, year }
}

/**
 * Determines which month a week belongs to based on weekday count (Mon-Fri)
 *
 * BUSINESS RULE: A week is assigned to the month containing MORE weekdays (L-V).
 * This is important for weeks that cross month boundaries.
 *
 * @param weekStart - The Monday 00:00:00 of the week
 * @returns Object with month (0-11), year, and weekday count
 *
 * @example
 * // Week Dec 30, 2024 - Jan 5, 2025
 * // Mon Dec 30, Tue Dec 31 = 2 days in December
 * // Wed Jan 1, Thu Jan 2, Fri Jan 3 = 3 days in January
 * getWeekBelongsToMonth(new Date('2024-12-30'))
 * // Returns: { month: 0, year: 2025, weekdaysInMonth: 3 }
 *
 * @example
 * // Week Jul 28 - Aug 3, 2025
 * // Mon Jul 28, Tue Jul 29, Wed Jul 30, Thu Jul 31 = 4 days in July
 * // Fri Aug 1 = 1 day in August
 * getWeekBelongsToMonth(new Date('2025-07-28'))
 * // Returns: { month: 6, year: 2025, weekdaysInMonth: 4 }
 */
export function getWeekBelongsToMonth(weekStart: Date): WeekMonthAssignment {
  const monthDays: Map<string, { month: number; year: number; count: number }> =
    new Map()

  // Count only weekdays (Mon-Fri = indices 0-4 from week start)
  for (let i = 0; i < 5; i++) {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)

    const month = d.getMonth()
    const year = d.getFullYear()
    const key = `${year}-${month}`

    const existing = monthDays.get(key)
    if (existing) {
      existing.count++
    } else {
      monthDays.set(key, { month, year, count: 1 })
    }
  }

  // Find month with most weekdays
  let maxEntry: { month: number; year: number; count: number } | null = null

  for (const entry of monthDays.values()) {
    if (!maxEntry || entry.count > maxEntry.count) {
      maxEntry = entry
    }
  }

  // This should never happen, but TypeScript requires the check
  if (!maxEntry) {
    const d = new Date(weekStart)
    return { month: d.getMonth(), year: d.getFullYear(), weekdaysInMonth: 5 }
  }

  return {
    month: maxEntry.month,
    year: maxEntry.year,
    weekdaysInMonth: maxEntry.count,
  }
}

/**
 * Gets all weeks that belong to a specific month
 *
 * A week belongs to a month if it has MORE weekdays (Mon-Fri) in that month
 * than in any other month.
 *
 * @param year - The year (e.g., 2024)
 * @param month - The month (0-11, where 0=January)
 * @returns Array of WeekRange objects for all weeks in that month
 *
 * @example
 * getWeeksInMonth(2024, 11) // December 2024
 * // Returns array of 4-5 WeekRange objects
 */
export function getWeeksInMonth(year: number, month: number): WeekRange[] {
  const weeks: WeekRange[] = []

  // Start from first day of month
  const firstDay = new Date(year, month, 1)
  let currentWeekStart = getWeekStart(firstDay)

  // Keep checking weeks until we're past the month
  // We need to check a bit into the next month to catch boundary weeks
  const lastDayOfMonth = new Date(year, month + 1, 0)
  const checkUntil = new Date(lastDayOfMonth)
  checkUntil.setDate(checkUntil.getDate() + 7) // Check one week past month end

  while (currentWeekStart <= checkUntil) {
    const assignment = getWeekBelongsToMonth(currentWeekStart)

    // Only include weeks that belong to this month
    if (assignment.month === month && assignment.year === year) {
      weeks.push(getActiveWeekRange(currentWeekStart))
    }

    // Move to next week
    currentWeekStart = new Date(currentWeekStart)
    currentWeekStart.setDate(currentWeekStart.getDate() + 7)
  }

  return weeks
}

/**
 * Checks if a given date falls within the current active week
 *
 * @param date - The date to check
 * @returns true if the date is in the current active week
 *
 * @example
 * // Assuming today is Wed Dec 11, 2024
 * isInCurrentActiveWeek(new Date('2024-12-10')) // Tue Dec 10
 * // Returns: true (same week)
 *
 * isInCurrentActiveWeek(new Date('2024-12-08')) // Sun Dec 8
 * // Returns: false (previous week)
 */
export function isInCurrentActiveWeek(date: Date): boolean {
  const now = new Date()
  const currentWeek = getActiveWeekRange(now)
  const checkDate = new Date(date)

  return checkDate >= currentWeek.start && checkDate <= currentWeek.end
}

/**
 * Checks if a date falls within a specific week range
 *
 * @param date - The date to check
 * @param weekRange - The week range to check against
 * @returns true if the date is within the week range
 */
export function isDateInWeek(date: Date, weekRange: WeekRange): boolean {
  const checkDate = new Date(date)
  return checkDate >= weekRange.start && checkDate <= weekRange.end
}

/**
 * Gets the previous week range from a given week
 *
 * @param weekRange - The current week range
 * @returns WeekRange for the previous week
 */
export function getPreviousWeek(weekRange: WeekRange): WeekRange {
  const previousStart = new Date(weekRange.start)
  previousStart.setDate(previousStart.getDate() - 7)
  return getActiveWeekRange(previousStart)
}

/**
 * Gets the next week range from a given week
 *
 * @param weekRange - The current week range
 * @returns WeekRange for the next week
 */
export function getNextWeek(weekRange: WeekRange): WeekRange {
  const nextStart = new Date(weekRange.start)
  nextStart.setDate(nextStart.getDate() + 7)
  return getActiveWeekRange(nextStart)
}

/**
 * Formats a week range for display
 *
 * @param weekRange - The week range to format
 * @param locale - The locale for formatting (default: 'es-MX')
 * @returns Formatted string like "9-15 Dic 2024" or "30 Dic - 5 Ene"
 */
export function formatWeekRange(
  weekRange: WeekRange,
  locale: string = 'es-MX'
): string {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
  }

  const startFormatted = weekRange.start.toLocaleDateString(locale, options)
  const endFormatted = weekRange.end.toLocaleDateString(locale, {
    ...options,
    year: 'numeric',
  })

  // If same month, only show month once
  if (
    weekRange.start.getMonth() === weekRange.end.getMonth() &&
    weekRange.start.getFullYear() === weekRange.end.getFullYear()
  ) {
    return `${weekRange.start.getDate()}-${endFormatted}`
  }

  return `${startFormatted} - ${endFormatted}`
}
