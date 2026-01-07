import { GraphQLError } from 'graphql'
import type { PrismaClient } from '@solufacil/database'

export interface LocationRouteHistoryInput {
  locationId: string
  routeId: string
  startDate: Date
  endDate?: Date | null
}

export class LocationHistoryService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get the full route history for a location
   */
  async getLocationHistory(locationId: string) {
    return this.prisma.locationRouteHistory.findMany({
      where: { locationId },
      orderBy: { startDate: 'desc' },
    })
  }

  /**
   * Get all locations that were in a specific route at a given date
   */
  async getLocationsInRouteAtDate(routeId: string, date: Date) {
    const historyRecords = await this.prisma.locationRouteHistory.findMany({
      where: {
        routeId,
        startDate: { lte: date },
        OR: [
          { endDate: null },
          { endDate: { gte: date } },
        ],
      },
      include: {
        location: {
          include: {
            municipalityRelation: {
              include: {
                stateRelation: true,
              },
            },
          },
        },
      },
    })

    return historyRecords.map((record) => record.location)
  }

  /**
   * Get the route a location was assigned to at a specific date
   */
  async getRouteForLocationAtDate(locationId: string, date: Date): Promise<string | null> {
    const history = await this.prisma.locationRouteHistory.findFirst({
      where: {
        locationId,
        startDate: { lte: date },
        OR: [
          { endDate: null },
          { endDate: { gte: date } },
        ],
      },
      orderBy: { startDate: 'desc' },
    })

    return history?.routeId ?? null
  }

  /**
   * Get the routes for multiple locations at a specific date (batch lookup)
   * Returns a Map of locationId -> routeId
   */
  async getRoutesForLocationsAtDate(locationIds: string[], date: Date): Promise<Map<string, string>> {
    if (locationIds.length === 0) {
      return new Map()
    }

    const histories = await this.prisma.locationRouteHistory.findMany({
      where: {
        locationId: { in: locationIds },
        startDate: { lte: date },
        OR: [
          { endDate: null },
          { endDate: { gte: date } },
        ],
      },
      orderBy: { startDate: 'desc' },
    })

    // Group by locationId and take the most recent (first due to orderBy desc)
    const result = new Map<string, string>()
    for (const history of histories) {
      if (!result.has(history.locationId)) {
        result.set(history.locationId, history.routeId)
      }
    }

    return result
  }

  /**
   * Get all location IDs that were in any of the specified routes at a given date
   */
  async getLocationIdsInRoutesAtDate(routeIds: string[], date: Date): Promise<Set<string>> {
    if (routeIds.length === 0) {
      return new Set()
    }

    const histories = await this.prisma.locationRouteHistory.findMany({
      where: {
        routeId: { in: routeIds },
        startDate: { lte: date },
        OR: [
          { endDate: null },
          { endDate: { gte: date } },
        ],
      },
      select: { locationId: true },
    })

    return new Set(histories.map((h) => h.locationId))
  }

  /**
   * Get all location IDs that were in any of the specified routes at ANY point during a period.
   * This is useful for reports where we need to include all locations that were ever in the routes
   * during the reporting period, even if they moved out before the end date.
   */
  async getLocationIdsInRoutesDuringPeriod(
    routeIds: string[],
    fromDate: Date,
    toDate: Date
  ): Promise<Set<string>> {
    if (routeIds.length === 0) {
      return new Set()
    }

    // A location was in a route during the period if:
    // 1. It was assigned to one of the routes (routeId in routeIds)
    // 2. AND its assignment overlaps with [fromDate, toDate]:
    //    - startDate <= toDate (started before or during the period)
    //    - AND (endDate is null OR endDate >= fromDate) (ended after or during the period, or still active)
    const histories = await this.prisma.locationRouteHistory.findMany({
      where: {
        routeId: { in: routeIds },
        startDate: { lte: toDate },
        OR: [
          { endDate: null },
          { endDate: { gte: fromDate } },
        ],
      },
      select: { locationId: true },
    })

    return new Set(histories.map((h) => h.locationId))
  }

  /**
   * Batch lookup: Get routes for multiple locations at multiple dates
   * Returns a Map<`${locationId}:${dateISOString}`, { routeId, routeName }>
   * Useful for reports where each loan may have a different reference date (e.g., signDate)
   */
  async getRoutesForLocationsAtDates(
    lookups: Array<{ locationId: string; date: Date }>
  ): Promise<Map<string, { routeId: string; routeName: string }>> {
    if (lookups.length === 0) {
      return new Map()
    }

    // Get unique locationIds
    const locationIds = Array.from(new Set(lookups.map((l) => l.locationId).filter(Boolean)))
    if (locationIds.length === 0) {
      return new Map()
    }

    // Get all history records for these locations with route names
    const histories = await this.prisma.locationRouteHistory.findMany({
      where: {
        locationId: { in: locationIds },
      },
      include: {
        route: {
          select: { id: true, name: true },
        },
      },
      orderBy: { startDate: 'desc' },
    })

    // Build result map
    const result = new Map<string, { routeId: string; routeName: string }>()

    for (const lookup of lookups) {
      if (!lookup.locationId) continue

      const key = `${lookup.locationId}:${lookup.date.toISOString()}`

      // Find matching history record for this location and date
      const matching = histories.find(
        (h) =>
          h.locationId === lookup.locationId &&
          h.startDate <= lookup.date &&
          (h.endDate === null || h.endDate >= lookup.date)
      )

      if (matching) {
        result.set(key, {
          routeId: matching.routeId,
          routeName: matching.route.name,
        })
      }
    }

    return result
  }

  /**
   * Get the current route for a location (endDate is null)
   */
  async getCurrentRoute(locationId: string): Promise<string | null> {
    const current = await this.prisma.locationRouteHistory.findFirst({
      where: {
        locationId,
        endDate: null,
      },
      orderBy: { startDate: 'desc' },
    })

    return current?.routeId ?? null
  }

  /**
   * Change a location's route with an effective date.
   * This will:
   * 1. Close the current assignment (set endDate to effectiveDate - 1 day)
   * 2. Create a new assignment starting at effectiveDate
   */
  async changeLocationRoute(locationId: string, newRouteId: string, effectiveDate: Date) {
    // Validate location exists
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    })
    if (!location) {
      throw new GraphQLError('Location not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Validate route exists
    const route = await this.prisma.route.findUnique({
      where: { id: newRouteId },
    })
    if (!route) {
      throw new GraphQLError('Route not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Find current active assignment
    const currentAssignment = await this.prisma.locationRouteHistory.findFirst({
      where: {
        locationId,
        endDate: null,
      },
      orderBy: { startDate: 'desc' },
    })

    // Calculate the day before effectiveDate for closing current assignment
    const dayBeforeEffective = new Date(effectiveDate)
    dayBeforeEffective.setDate(dayBeforeEffective.getDate() - 1)

    return this.prisma.$transaction(async (tx) => {
      // Close current assignment if exists
      if (currentAssignment) {
        // Only close if the new effectiveDate is after the current startDate
        if (effectiveDate > currentAssignment.startDate) {
          await tx.locationRouteHistory.update({
            where: { id: currentAssignment.id },
            data: { endDate: dayBeforeEffective },
          })
        } else {
          // If effectiveDate is on or before current startDate, delete the current assignment
          await tx.locationRouteHistory.delete({
            where: { id: currentAssignment.id },
          })
        }
      }

      // Create new assignment
      const newAssignment = await tx.locationRouteHistory.create({
        data: {
          locationId,
          routeId: newRouteId,
          startDate: effectiveDate,
          endDate: null,
        },
      })

      // Update the Location.route field to reflect current route
      await tx.location.update({
        where: { id: locationId },
        data: { route: newRouteId },
      })

      return newAssignment
    })
  }

  /**
   * Upsert a historical assignment (for manual corrections or imports)
   *
   * SMART BEHAVIOR: Automatically adjusts overlapping assignments by moving
   * their startDate to the day after the new assignment's endDate.
   * This works for both:
   * - Current assignment (endDate = null)
   * - Historical assignments (endDate != null)
   *
   * If an adjustment would make a record invalid (startDate > endDate), that
   * record is deleted as it's completely contained within the new period.
   *
   * Example 1 - Overlaps with current:
   * - Current: RUTA_CIUDAD from 2020-01-01 to NULL
   * - New historical: RUTA_1B from 2020-01-01 to 2025-01-01
   * - Result:
   *   - RUTA_1B from 2020-01-01 to 2025-01-01 (new)
   *   - RUTA_CIUDAD from 2025-01-02 to NULL (adjusted)
   *
   * Example 2 - Overlaps with historical:
   * - Existing: RUTA_1B from 2020-01-01 to 2025-01-01
   * - Existing: RUTA_CIUDAD from 2025-01-02 to NULL
   * - New historical: RUTA_X from 2020-01-01 to 2024-01-01
   * - Result:
   *   - RUTA_X from 2020-01-01 to 2024-01-01 (new)
   *   - RUTA_1B from 2024-01-02 to 2025-01-01 (adjusted)
   *   - RUTA_CIUDAD from 2025-01-02 to NULL (unchanged)
   *
   * Example 3 - Completely replaces existing:
   * - Existing: RUTA_OLD from 2022-01-01 to 2022-06-01
   * - New historical: RUTA_NEW from 2020-01-01 to 2024-01-01
   * - Result:
   *   - RUTA_NEW from 2020-01-01 to 2024-01-01 (new)
   *   - RUTA_OLD is DELETED (would have invalid dates after adjustment)
   */
  async upsertHistoricalAssignment(input: LocationRouteHistoryInput) {
    // Validate location exists
    const location = await this.prisma.location.findUnique({
      where: { id: input.locationId },
    })
    if (!location) {
      throw new GraphQLError('Location not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Validate route exists
    const route = await this.prisma.route.findUnique({
      where: { id: input.routeId },
    })
    if (!route) {
      throw new GraphQLError('Route not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // The new assignment MUST have an endDate (it's historical, not current)
    if (!input.endDate) {
      throw new GraphQLError('Historical assignments must have an end date', {
        extensions: { code: 'VALIDATION_ERROR' },
      })
    }

    const newEndDate = input.endDate

    // Check for overlapping assignments
    const overlappingAssignments = await this.prisma.locationRouteHistory.findMany({
      where: {
        locationId: input.locationId,
        startDate: { lte: newEndDate },
        OR: [
          { endDate: null },
          { endDate: { gte: input.startDate } },
        ],
      },
      orderBy: { startDate: 'asc' },
    })

    // Calculate the day after the new assignment ends
    const dayAfterEndDate = new Date(newEndDate)
    dayAfterEndDate.setDate(dayAfterEndDate.getDate() + 1)

    return this.prisma.$transaction(async (tx) => {
      // Process each overlapping assignment
      for (const existing of overlappingAssignments) {
        // Only adjust if the new assignment's endDate is >= existing's startDate
        if (newEndDate >= existing.startDate) {
          if (existing.endDate === null) {
            // Current assignment: just adjust startDate
            await tx.locationRouteHistory.update({
              where: { id: existing.id },
              data: { startDate: dayAfterEndDate },
            })
          } else {
            // Historical assignment: check if adjustment would be valid
            // If dayAfterEndDate > existing.endDate, the record would be invalid (startDate > endDate)
            if (dayAfterEndDate > existing.endDate) {
              // Delete the record as it's completely contained within the new period
              await tx.locationRouteHistory.delete({
                where: { id: existing.id },
              })
            } else {
              // Adjust the startDate
              await tx.locationRouteHistory.update({
                where: { id: existing.id },
                data: { startDate: dayAfterEndDate },
              })
            }
          }
        }
      }

      // Create the new historical assignment
      return tx.locationRouteHistory.create({
        data: {
          locationId: input.locationId,
          routeId: input.routeId,
          startDate: input.startDate,
          endDate: input.endDate,
        },
      })
    })
  }

  /**
   * Update an existing historical assignment
   */
  async updateHistoricalAssignment(id: string, input: LocationRouteHistoryInput) {
    const existing = await this.prisma.locationRouteHistory.findUnique({
      where: { id },
    })
    if (!existing) {
      throw new GraphQLError('History record not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Validate route exists
    const route = await this.prisma.route.findUnique({
      where: { id: input.routeId },
    })
    if (!route) {
      throw new GraphQLError('Route not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Check for overlapping assignments (excluding current record)
    const overlapping = await this.prisma.locationRouteHistory.findFirst({
      where: {
        id: { not: id },
        locationId: input.locationId,
        startDate: { lte: input.endDate ?? new Date('9999-12-31') },
        OR: [
          { endDate: null },
          { endDate: { gte: input.startDate } },
        ],
      },
    })

    if (overlapping) {
      throw new GraphQLError('This assignment overlaps with an existing assignment', {
        extensions: {
          code: 'VALIDATION_ERROR',
          overlappingId: overlapping.id,
        },
      })
    }

    return this.prisma.locationRouteHistory.update({
      where: { id },
      data: {
        routeId: input.routeId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    })
  }

  /**
   * Delete a historical assignment
   */
  async deleteHistoricalAssignment(id: string) {
    const existing = await this.prisma.locationRouteHistory.findUnique({
      where: { id },
    })
    if (!existing) {
      throw new GraphQLError('History record not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    await this.prisma.locationRouteHistory.delete({
      where: { id },
    })
  }
}
