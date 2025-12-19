import { describe, it, expect } from 'vitest'
import {
  getWeekStart,
  getWeekEnd,
  getISOWeekNumber,
  getActiveWeekRange,
  getWeekBelongsToMonth,
  getWeeksInMonth,
  isInCurrentActiveWeek,
  isDateInWeek,
  getPreviousWeek,
  getNextWeek,
  formatWeekRange,
} from '../../src/calculations/active-week'

describe('Active Week Calculations', () => {
  describe('getWeekStart', () => {
    it('returns Monday for a Wednesday', () => {
      // Wed Dec 11, 2024
      const date = new Date('2024-12-11T12:00:00')
      const result = getWeekStart(date)

      expect(result.getDay()).toBe(1) // Monday
      expect(result.getDate()).toBe(9) // Dec 9
      expect(result.getHours()).toBe(0)
      expect(result.getMinutes()).toBe(0)
    })

    it('returns same Monday for a Monday', () => {
      // Mon Dec 9, 2024
      const date = new Date('2024-12-09T12:00:00')
      const result = getWeekStart(date)

      expect(result.getDay()).toBe(1)
      expect(result.getDate()).toBe(9)
    })

    it('returns previous Monday for a Sunday', () => {
      // Sun Dec 15, 2024
      const date = new Date('2024-12-15T12:00:00')
      const result = getWeekStart(date)

      expect(result.getDay()).toBe(1)
      expect(result.getDate()).toBe(9) // Previous Monday
    })

    it('returns Monday for a Saturday', () => {
      // Sat Dec 14, 2024
      const date = new Date('2024-12-14T12:00:00')
      const result = getWeekStart(date)

      expect(result.getDay()).toBe(1)
      expect(result.getDate()).toBe(9)
    })

    it('handles month boundary correctly', () => {
      // Wed Jan 1, 2025 - week starts in December
      const date = new Date('2025-01-01T12:00:00')
      const result = getWeekStart(date)

      expect(result.getDay()).toBe(1)
      expect(result.getMonth()).toBe(11) // December
      expect(result.getDate()).toBe(30) // Dec 30, 2024
      expect(result.getFullYear()).toBe(2024)
    })
  })

  describe('getWeekEnd', () => {
    it('returns Sunday 23:59:59 for a Monday start', () => {
      // Mon Dec 9, 2024
      const weekStart = new Date('2024-12-09T00:00:00')
      const result = getWeekEnd(weekStart)

      expect(result.getDay()).toBe(0) // Sunday
      expect(result.getDate()).toBe(15) // Dec 15
      expect(result.getHours()).toBe(23)
      expect(result.getMinutes()).toBe(59)
      expect(result.getSeconds()).toBe(59)
    })

    it('handles month boundary correctly', () => {
      // Mon Dec 30, 2024 - week ends in January
      const weekStart = new Date('2024-12-30T00:00:00')
      const result = getWeekEnd(weekStart)

      expect(result.getDay()).toBe(0)
      expect(result.getMonth()).toBe(0) // January
      expect(result.getDate()).toBe(5) // Jan 5, 2025
      expect(result.getFullYear()).toBe(2025)
    })
  })

  describe('getISOWeekNumber', () => {
    it('returns correct week number for mid-year date', () => {
      // Mid-July 2024 should be around week 28-29
      const date = new Date('2024-07-15T12:00:00')
      const result = getISOWeekNumber(date)

      // Expect week number in valid range for mid-July
      expect(result).toBeGreaterThanOrEqual(28)
      expect(result).toBeLessThanOrEqual(30)
    })

    it('returns week 1 for first week of year', () => {
      // Jan 4, 2024 is always in week 1
      const date = new Date('2024-01-04')
      const result = getISOWeekNumber(date)

      expect(result).toBe(1)
    })

    it('returns week 52 or 53 for last week of year', () => {
      // Dec 30, 2024
      const date = new Date('2024-12-30')
      const result = getISOWeekNumber(date)

      expect(result).toBeGreaterThanOrEqual(52)
      expect(result).toBeLessThanOrEqual(53)
    })
  })

  describe('getActiveWeekRange', () => {
    it('returns complete week range', () => {
      const date = new Date('2024-12-11T12:00:00')
      const result = getActiveWeekRange(date)

      expect(result.start.getDay()).toBe(1) // Monday
      expect(result.end.getDay()).toBe(0) // Sunday
      expect(result.weekNumber).toBeGreaterThan(0)
      expect(result.year).toBe(2024)
    })

    it('start is before end', () => {
      const date = new Date('2024-12-11')
      const result = getActiveWeekRange(date)

      expect(result.start.getTime()).toBeLessThan(result.end.getTime())
    })
  })

  describe('getWeekBelongsToMonth', () => {
    it('assigns week to month with more weekdays', () => {
      // Week Dec 30, 2024 - Jan 5, 2025
      // Mon Dec 30, Tue Dec 31 = 2 days December
      // Wed Jan 1, Thu Jan 2, Fri Jan 3 = 3 days January
      const weekStart = new Date('2024-12-30T00:00:00')
      const result = getWeekBelongsToMonth(weekStart)

      expect(result.month).toBe(0) // January
      expect(result.year).toBe(2025)
      expect(result.weekdaysInMonth).toBe(3)
    })

    it('assigns week to earlier month when it has more weekdays', () => {
      // Week Jul 28 - Aug 3, 2025
      // Mon Jul 28, Tue Jul 29, Wed Jul 30, Thu Jul 31 = 4 days July
      // Fri Aug 1 = 1 day August
      const weekStart = new Date('2025-07-28T00:00:00')
      const result = getWeekBelongsToMonth(weekStart)

      expect(result.month).toBe(6) // July (0-indexed)
      expect(result.year).toBe(2025)
      expect(result.weekdaysInMonth).toBe(4)
    })

    it('handles week fully in one month', () => {
      // Week Dec 9-15, 2024 - all in December
      const weekStart = new Date('2024-12-09T00:00:00')
      const result = getWeekBelongsToMonth(weekStart)

      expect(result.month).toBe(11) // December
      expect(result.year).toBe(2024)
      expect(result.weekdaysInMonth).toBe(5)
    })
  })

  describe('getWeeksInMonth', () => {
    it('returns 4-5 weeks for a month', () => {
      // December 2024
      const result = getWeeksInMonth(2024, 11)

      expect(result.length).toBeGreaterThanOrEqual(4)
      expect(result.length).toBeLessThanOrEqual(5)
    })

    it('all returned weeks belong to the month', () => {
      // December 2024
      const result = getWeeksInMonth(2024, 11)

      for (const week of result) {
        const assignment = getWeekBelongsToMonth(week.start)
        expect(assignment.month).toBe(11)
        expect(assignment.year).toBe(2024)
      }
    })

    it('weeks are in chronological order', () => {
      const result = getWeeksInMonth(2024, 11)

      for (let i = 1; i < result.length; i++) {
        expect(result[i].start.getTime()).toBeGreaterThan(
          result[i - 1].start.getTime()
        )
      }
    })

    it('handles January correctly with year boundary', () => {
      // January 2025 - first week might start in December 2024
      const result = getWeeksInMonth(2025, 0)

      expect(result.length).toBeGreaterThanOrEqual(4)

      for (const week of result) {
        const assignment = getWeekBelongsToMonth(week.start)
        expect(assignment.month).toBe(0) // January
        expect(assignment.year).toBe(2025)
      }
    })
  })

  describe('isDateInWeek', () => {
    it('returns true for date within week', () => {
      const week = getActiveWeekRange(new Date('2024-12-11'))
      const dateInWeek = new Date('2024-12-12T14:30:00')

      expect(isDateInWeek(dateInWeek, week)).toBe(true)
    })

    it('returns true for Monday 00:00', () => {
      const week = getActiveWeekRange(new Date('2024-12-11'))
      const mondayMidnight = new Date('2024-12-09T00:00:00')

      expect(isDateInWeek(mondayMidnight, week)).toBe(true)
    })

    it('returns true for Sunday 23:59', () => {
      const week = getActiveWeekRange(new Date('2024-12-11'))
      const sundayEnd = new Date('2024-12-15T23:59:59')

      expect(isDateInWeek(sundayEnd, week)).toBe(true)
    })

    it('returns false for date before week', () => {
      const week = getActiveWeekRange(new Date('2024-12-11'))
      const dateBefore = new Date('2024-12-08T23:59:59')

      expect(isDateInWeek(dateBefore, week)).toBe(false)
    })

    it('returns false for date after week', () => {
      const week = getActiveWeekRange(new Date('2024-12-11'))
      const dateAfter = new Date('2024-12-16T00:00:00')

      expect(isDateInWeek(dateAfter, week)).toBe(false)
    })
  })

  describe('getPreviousWeek', () => {
    it('returns week 7 days before', () => {
      const currentWeek = getActiveWeekRange(new Date('2024-12-11'))
      const previousWeek = getPreviousWeek(currentWeek)

      const diff =
        currentWeek.start.getTime() - previousWeek.start.getTime()
      const daysDiff = diff / (1000 * 60 * 60 * 24)

      expect(daysDiff).toBe(7)
    })

    it('handles month boundary', () => {
      // Week of Dec 2-8, previous would be Nov 25 - Dec 1
      const week = getActiveWeekRange(new Date('2024-12-04'))
      const previousWeek = getPreviousWeek(week)

      expect(previousWeek.start.getMonth()).toBe(10) // November
    })
  })

  describe('getNextWeek', () => {
    it('returns week 7 days after', () => {
      const currentWeek = getActiveWeekRange(new Date('2024-12-11'))
      const nextWeek = getNextWeek(currentWeek)

      const diff = nextWeek.start.getTime() - currentWeek.start.getTime()
      const daysDiff = diff / (1000 * 60 * 60 * 24)

      expect(daysDiff).toBe(7)
    })

    it('handles year boundary', () => {
      // Week of Dec 30 - Jan 5, next would be Jan 6-12
      const week = getActiveWeekRange(new Date('2024-12-31'))
      const nextWeek = getNextWeek(week)

      expect(nextWeek.start.getMonth()).toBe(0) // January
      expect(nextWeek.start.getFullYear()).toBe(2025)
    })
  })

  describe('formatWeekRange', () => {
    it('formats week within same month', () => {
      const week = getActiveWeekRange(new Date('2024-12-11'))
      const formatted = formatWeekRange(week, 'es-MX')

      // Should be something like "9-15 dic 2024"
      expect(formatted).toContain('9')
      expect(formatted).toContain('15')
    })

    it('formats week crossing months', () => {
      const week = getActiveWeekRange(new Date('2024-12-31'))
      const formatted = formatWeekRange(week, 'es-MX')

      // Should show both months
      expect(formatted).toContain('-')
    })
  })

  describe('isInCurrentActiveWeek', () => {
    it('returns true for today', () => {
      const today = new Date()
      expect(isInCurrentActiveWeek(today)).toBe(true)
    })

    it('returns false for date far in past', () => {
      const pastDate = new Date('2020-01-01')
      expect(isInCurrentActiveWeek(pastDate)).toBe(false)
    })
  })
})
