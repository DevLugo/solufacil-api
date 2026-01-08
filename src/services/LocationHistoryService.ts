import { GraphQLError } from 'graphql'
import type { PrismaClient } from '@solufacil/database'

export interface LocationRouteHistoryInput {
  locationId: string
  routeId: string
  startDate: Date
  endDate?: Date | null
}

export interface BatchChangeLocationRouteInput {
  locationIds: string[]
  newRouteId: string
  effectiveDate: Date
}

export interface BatchLocationRouteChangeResult {
  success: boolean
  message: string
  changesApplied: number
  errors: Array<{
    locationId: string
    error: string
  }>
  details: Array<{
    locationId: string
    locationName: string
    previousRouteId: string | null
    previousRouteName: string | null
    newRouteId: string
    newRouteName: string
  }>
}

export interface BatchUpsertHistoricalInput {
  locationIds: string[]
  routeId: string
  startDate: Date
  endDate: Date
}

export interface BatchUpsertHistoricalResult {
  success: boolean
  message: string
  recordsCreated: number
  recordsAdjusted: number
  recordsDeleted: number
  errors: Array<{
    locationId: string
    error: string
  }>
  details: Array<{
    locationId: string
    locationName: string
    routeId: string
    routeName: string
    startDate: Date
    endDate: Date
  }>
}

export class LocationHistoryService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Normalize a date to the start of day (00:00:00.000)
   * Used for startDate to ensure any query on that day matches
   */
  private startOfDay(date: Date): Date {
    const result = new Date(date)
    result.setHours(0, 0, 0, 0)
    return result
  }

  /**
   * Normalize a date to the end of day (23:59:59.999)
   * Used for endDate to ensure any query on that day matches
   */
  private endOfDay(date: Date): Date {
    const result = new Date(date)
    result.setHours(23, 59, 59, 999)
    return result
  }

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
   * Date comparison is normalized to ignore time components
   */
  async getLocationsInRouteAtDate(routeId: string, date: Date) {
    // Normalize: for startDate check, use end of day so any startDate on that day matches
    // For endDate check, use start of day so any endDate on that day matches
    const dateEndOfDay = this.endOfDay(date)
    const dateStartOfDay = this.startOfDay(date)

    const historyRecords = await this.prisma.locationRouteHistory.findMany({
      where: {
        routeId,
        startDate: { lte: dateEndOfDay },
        OR: [
          { endDate: null },
          { endDate: { gte: dateStartOfDay } },
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
   * Date comparison is normalized to ignore time components
   */
  async getRouteForLocationAtDate(locationId: string, date: Date): Promise<string | null> {
    const dateEndOfDay = this.endOfDay(date)
    const dateStartOfDay = this.startOfDay(date)

    const history = await this.prisma.locationRouteHistory.findFirst({
      where: {
        locationId,
        startDate: { lte: dateEndOfDay },
        OR: [
          { endDate: null },
          { endDate: { gte: dateStartOfDay } },
        ],
      },
      orderBy: { startDate: 'desc' },
    })

    return history?.routeId ?? null
  }

  /**
   * Get the routes for multiple locations at a specific date (batch lookup)
   * Returns a Map of locationId -> routeId
   * Date comparison is normalized to ignore time components
   */
  async getRoutesForLocationsAtDate(locationIds: string[], date: Date): Promise<Map<string, string>> {
    if (locationIds.length === 0) {
      return new Map()
    }

    const dateEndOfDay = this.endOfDay(date)
    const dateStartOfDay = this.startOfDay(date)

    const histories = await this.prisma.locationRouteHistory.findMany({
      where: {
        locationId: { in: locationIds },
        startDate: { lte: dateEndOfDay },
        OR: [
          { endDate: null },
          { endDate: { gte: dateStartOfDay } },
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
   * Date comparison is normalized to ignore time components
   */
  async getLocationIdsInRoutesAtDate(routeIds: string[], date: Date): Promise<Set<string>> {
    if (routeIds.length === 0) {
      return new Set()
    }

    const dateEndOfDay = this.endOfDay(date)
    const dateStartOfDay = this.startOfDay(date)

    const histories = await this.prisma.locationRouteHistory.findMany({
      where: {
        routeId: { in: routeIds },
        startDate: { lte: dateEndOfDay },
        OR: [
          { endDate: null },
          { endDate: { gte: dateStartOfDay } },
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

      // Normalize dates for comparison (ignore time components)
      const lookupEndOfDay = this.endOfDay(lookup.date)
      const lookupStartOfDay = this.startOfDay(lookup.date)

      // Find matching history record for this location and date
      const matching = histories.find(
        (h) =>
          h.locationId === lookup.locationId &&
          h.startDate <= lookupEndOfDay &&
          (h.endDate === null || h.endDate >= lookupStartOfDay)
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
   * Batch change multiple locations to a new route with an effective date.
   * All changes are executed in a single transaction for atomicity.
   *
   * @param input - Object containing locationIds array, newRouteId, and effectiveDate
   * @returns Result with success status, counts, and details per location
   */
  async batchChangeLocationRoutes(
    input: BatchChangeLocationRouteInput
  ): Promise<BatchLocationRouteChangeResult> {
    const { locationIds, newRouteId, effectiveDate } = input
    const errors: BatchLocationRouteChangeResult['errors'] = []
    const details: BatchLocationRouteChangeResult['details'] = []

    if (locationIds.length === 0) {
      return {
        success: true,
        message: 'No locations to process',
        changesApplied: 0,
        errors: [],
        details: [],
      }
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

    // Get all locations with their current route info
    const locations = await this.prisma.location.findMany({
      where: { id: { in: locationIds } },
      include: {
        routeRelation: { select: { id: true, name: true } },
      },
    })

    // Check for missing locations
    const foundIds = new Set(locations.map((l) => l.id))
    for (const id of locationIds) {
      if (!foundIds.has(id)) {
        errors.push({ locationId: id, error: 'Location not found' })
      }
    }

    // Get current active assignments for all locations
    const currentAssignments = await this.prisma.locationRouteHistory.findMany({
      where: {
        locationId: { in: locationIds },
        endDate: null,
      },
      include: {
        route: { select: { id: true, name: true } },
      },
    })

    // Map by locationId for quick lookup
    const assignmentByLocation = new Map(
      currentAssignments.map((a) => [a.locationId, a])
    )

    // Calculate the day before effectiveDate
    const dayBeforeEffective = new Date(effectiveDate)
    dayBeforeEffective.setDate(dayBeforeEffective.getDate() - 1)

    // Execute all changes in a single transaction
    await this.prisma.$transaction(async (tx) => {
      for (const location of locations) {
        const currentAssignment = assignmentByLocation.get(location.id)
        const previousRouteId = currentAssignment?.routeId ?? location.route
        const previousRouteName =
          currentAssignment?.route.name ?? location.routeRelation?.name ?? null

        // Close current assignment if exists
        if (currentAssignment) {
          if (effectiveDate > currentAssignment.startDate) {
            await tx.locationRouteHistory.update({
              where: { id: currentAssignment.id },
              data: { endDate: dayBeforeEffective },
            })
          } else {
            // If effectiveDate is on or before current startDate, delete it
            await tx.locationRouteHistory.delete({
              where: { id: currentAssignment.id },
            })
          }
        }

        // Create new assignment
        await tx.locationRouteHistory.create({
          data: {
            locationId: location.id,
            routeId: newRouteId,
            startDate: effectiveDate,
            endDate: null,
          },
        })

        // Update Location.route field
        await tx.location.update({
          where: { id: location.id },
          data: { route: newRouteId },
        })

        details.push({
          locationId: location.id,
          locationName: location.name,
          previousRouteId,
          previousRouteName,
          newRouteId: route.id,
          newRouteName: route.name,
        })
      }
    })

    const changesApplied = details.length
    const hasErrors = errors.length > 0

    return {
      success: !hasErrors || changesApplied > 0,
      message: hasErrors
        ? `${changesApplied} locations moved, ${errors.length} errors`
        : `${changesApplied} locations moved to ${route.name}`,
      changesApplied,
      errors,
      details,
    }
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

    console.log('[LocationHistoryService] upsertHistoricalAssignment - Input:', {
      locationId: input.locationId,
      routeId: input.routeId,
      startDate: input.startDate,
      endDate: input.endDate,
    })
    console.log('[LocationHistoryService] Found overlapping assignments:', overlappingAssignments.map(a => ({
      id: a.id,
      routeId: a.routeId,
      startDate: a.startDate,
      endDate: a.endDate,
    })))

    return this.prisma.$transaction(async (tx) => {
      // Process each overlapping assignment
      for (const existing of overlappingAssignments) {
        // Only adjust if the new assignment's endDate is >= existing's startDate
        if (newEndDate >= existing.startDate) {
          if (existing.endDate === null) {
            // Current assignment: just adjust startDate
            console.log(`[LocationHistoryService] Adjusting current assignment ${existing.id} (routeId: ${existing.routeId}) startDate to:`, dayAfterEndDate)
            await tx.locationRouteHistory.update({
              where: { id: existing.id },
              data: { startDate: dayAfterEndDate },
            })
          } else {
            // Historical assignment: check if adjustment would be valid
            // If dayAfterEndDate > existing.endDate, the record would be invalid (startDate > endDate)
            if (dayAfterEndDate > existing.endDate) {
              // Delete the record as it's completely contained within the new period
              console.log(`[LocationHistoryService] Deleting contained assignment ${existing.id} (routeId: ${existing.routeId})`)
              await tx.locationRouteHistory.delete({
                where: { id: existing.id },
              })
            } else {
              // Adjust the startDate
              console.log(`[LocationHistoryService] Adjusting historical assignment ${existing.id} (routeId: ${existing.routeId}) startDate to:`, dayAfterEndDate)
              await tx.locationRouteHistory.update({
                where: { id: existing.id },
                data: { startDate: dayAfterEndDate },
              })
            }
          }
        }
      }

      // Create the new historical assignment
      console.log('[LocationHistoryService] Creating new assignment with routeId:', input.routeId)
      const newRecord = await tx.locationRouteHistory.create({
        data: {
          locationId: input.locationId,
          routeId: input.routeId,
          startDate: input.startDate,
          endDate: input.endDate,
        },
      })
      console.log('[LocationHistoryService] Created record:', newRecord)
      return newRecord
    })
  }

  /**
   * Batch upsert historical assignments for multiple locations.
   * Applies the same historical period to all specified locations.
   * Each location is processed with the same "smart" overlap adjustment logic.
   *
   * @param input - Object containing locationIds array, routeId, startDate, and endDate
   * @returns Result with counts of records created, adjusted, and deleted
   */
  async batchUpsertHistoricalAssignment(
    input: BatchUpsertHistoricalInput
  ): Promise<BatchUpsertHistoricalResult> {
    const { locationIds, routeId, startDate, endDate } = input
    const errors: BatchUpsertHistoricalResult['errors'] = []
    const details: BatchUpsertHistoricalResult['details'] = []
    let recordsCreated = 0
    let recordsAdjusted = 0
    let recordsDeleted = 0

    if (locationIds.length === 0) {
      return {
        success: true,
        message: 'No locations to process',
        recordsCreated: 0,
        recordsAdjusted: 0,
        recordsDeleted: 0,
        errors: [],
        details: [],
      }
    }

    // Validate route exists
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
    })
    if (!route) {
      throw new GraphQLError('Route not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Get all locations
    const locations = await this.prisma.location.findMany({
      where: { id: { in: locationIds } },
    })

    // Check for missing locations
    const foundIds = new Set(locations.map((l) => l.id))
    for (const id of locationIds) {
      if (!foundIds.has(id)) {
        errors.push({ locationId: id, error: 'Location not found' })
      }
    }

    // Calculate the day after the new assignment ends
    const dayAfterEndDate = new Date(endDate)
    dayAfterEndDate.setDate(dayAfterEndDate.getDate() + 1)

    // Execute all changes in a single transaction
    await this.prisma.$transaction(async (tx) => {
      for (const location of locations) {
        // Find overlapping assignments for this location
        const overlappingAssignments = await tx.locationRouteHistory.findMany({
          where: {
            locationId: location.id,
            startDate: { lte: endDate },
            OR: [
              { endDate: null },
              { endDate: { gte: startDate } },
            ],
          },
          orderBy: { startDate: 'asc' },
        })

        // Process each overlapping assignment
        for (const existing of overlappingAssignments) {
          if (endDate >= existing.startDate) {
            if (existing.endDate === null) {
              // Current assignment: adjust startDate
              await tx.locationRouteHistory.update({
                where: { id: existing.id },
                data: { startDate: dayAfterEndDate },
              })
              recordsAdjusted++
            } else {
              // Historical assignment: check if adjustment would be valid
              if (dayAfterEndDate > existing.endDate) {
                // Delete the record as it's completely contained
                await tx.locationRouteHistory.delete({
                  where: { id: existing.id },
                })
                recordsDeleted++
              } else {
                // Adjust the startDate
                await tx.locationRouteHistory.update({
                  where: { id: existing.id },
                  data: { startDate: dayAfterEndDate },
                })
                recordsAdjusted++
              }
            }
          }
        }

        // Create the new historical assignment
        await tx.locationRouteHistory.create({
          data: {
            locationId: location.id,
            routeId,
            startDate,
            endDate,
          },
        })
        recordsCreated++

        details.push({
          locationId: location.id,
          locationName: location.name,
          routeId: route.id,
          routeName: route.name,
          startDate,
          endDate,
        })
      }
    })

    const hasErrors = errors.length > 0

    return {
      success: !hasErrors || recordsCreated > 0,
      message: hasErrors
        ? `${recordsCreated} records created, ${errors.length} errors`
        : `${recordsCreated} historical records created for ${route.name}`,
      recordsCreated,
      recordsAdjusted,
      recordsDeleted,
      errors,
      details,
    }
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
