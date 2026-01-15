import type { PrismaClient, Location } from '@solufacil/database'
import {
  getActiveWeekRange,
  countClientsStatus,
  haversineDistance,
  calculateTotalDistance,
  type WeekRange,
  type LoanForPortfolio,
  type PaymentForCV,
} from '@solufacil/business-logic'
import { GraphQLError } from 'graphql'
import { LocationHistoryService } from './LocationHistoryService'

/**
 * Statistics for a location in route planning context
 */
export interface LocationPlanningStats {
  locationId: string
  locationName: string
  latitude: number | null
  longitude: number | null
  totalClientes: number
  clientesActivos: number
  clientesEnCV: number
  clientesAlCorriente: number
}

/**
 * Statistics for a location with route info (for multi-route view)
 */
export interface LocationPlanningStatsWithRoute extends LocationPlanningStats {
  routeId: string
  routeName: string
}

/**
 * Aggregated statistics for multiple locations
 */
export interface AggregatedLocationStats {
  totalLocations: number
  totalClientes: number
  clientesActivos: number
  clientesEnCV: number
  clientesAlCorriente: number
  totalDistanceKm: number
}

/**
 * Input for updating location coordinates
 */
export interface UpdateLocationCoordinatesInput {
  locationId: string
  latitude: number
  longitude: number
}

/**
 * Service for route planning operations.
 * Provides location statistics and distance calculations for route optimization.
 */
export class RoutePlanningService {
  private locationHistoryService: LocationHistoryService

  constructor(private prisma: PrismaClient) {
    this.locationHistoryService = new LocationHistoryService(prisma)
  }

  /**
   * Gets the current active week for CV calculations
   */
  private getCurrentActiveWeek(): WeekRange {
    return getActiveWeekRange(new Date())
  }

  /**
   * Verifies that a route exists
   */
  private async verifyRouteExists(routeId: string): Promise<void> {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
    })

    if (!route) {
      throw new GraphQLError('Route not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }
  }

  /**
   * Fetches active loans for given location IDs
   */
  private async fetchActiveLoansForLocations(locationIds: string[]) {
    return this.prisma.loan.findMany({
      where: {
        pendingAmountStored: { gt: 0 },
        excludedByCleanup: null,
        renewedDate: null,
        finishedDate: null,
        borrowerRelation: {
          personalDataRelation: {
            addresses: {
              some: { location: { in: locationIds } },
            },
          },
        },
      },
      select: {
        id: true,
        signDate: true,
        requestedAmount: true,
        totalDebtAcquired: true,
        pendingAmountStored: true,
        totalPaid: true,
        badDebtDate: true,
        excludedByCleanup: true,
        renewedDate: true,
        finishedDate: true,
        previousLoan: true,
        loantypeRelation: {
          select: {
            rate: true,
            weekDuration: true,
          },
        },
        borrowerRelation: {
          select: {
            personalDataRelation: {
              select: {
                addresses: {
                  where: { location: { in: locationIds } },
                  take: 1,
                  select: { location: true },
                },
              },
            },
          },
        },
      },
    })
  }

  /**
   * Fetches payments for given loan IDs
   */
  private async fetchPaymentsForLoans(loanIds: string[]) {
    return this.prisma.loanPayment.findMany({
      where: { loan: { in: loanIds } },
      select: {
        id: true,
        loan: true,
        amount: true,
        receivedAt: true,
      },
    })
  }

  /**
   * Groups payments by loan ID into a map
   */
  private groupPaymentsByLoan(
    payments: Array<{ id: string; loan: string; amount: number | { toNumber(): number }; receivedAt: Date }>
  ): Map<string, PaymentForCV[]> {
    const paymentsMap = new Map<string, PaymentForCV[]>()
    for (const payment of payments) {
      const existing = paymentsMap.get(payment.loan) || []
      existing.push({
        id: payment.id,
        amount: Number(payment.amount),
        receivedAt: payment.receivedAt,
      })
      paymentsMap.set(payment.loan, existing)
    }
    return paymentsMap
  }

  /**
   * Groups loans by their location ID
   */
  private groupLoansByLocation(
    loans: Array<{
      id: string
      signDate: Date
      requestedAmount: number | { toNumber(): number }
      totalDebtAcquired: number | { toNumber(): number }
      pendingAmountStored: number | { toNumber(): number }
      totalPaid: number | { toNumber(): number }
      badDebtDate: Date | null
      excludedByCleanup: string | null
      renewedDate: Date | null
      finishedDate: Date | null
      previousLoan: string | null
      loantypeRelation: { rate: number | { toNumber(): number }; weekDuration: number } | null
      borrowerRelation: {
        personalDataRelation: {
          addresses: Array<{ location: string }>
        } | null
      } | null
    }>
  ): Map<string, LoanForPortfolio[]> {
    const loansByLocation = new Map<string, LoanForPortfolio[]>()
    for (const loan of loans) {
      const address = loan.borrowerRelation?.personalDataRelation?.addresses?.[0]
      const locationId = address?.location

      if (!locationId) continue

      const existing = loansByLocation.get(locationId) || []
      existing.push({
        id: loan.id,
        signDate: loan.signDate,
        requestedAmount: Number(loan.requestedAmount),
        totalDebt: Number(loan.totalDebtAcquired),
        pendingAmountStored: Number(loan.pendingAmountStored),
        totalPaid: Number(loan.totalPaid),
        rate: loan.loantypeRelation ? Number(loan.loantypeRelation.rate) : 0,
        weekDuration: loan.loantypeRelation?.weekDuration ?? 16,
        badDebtDate: loan.badDebtDate,
        excludedByCleanup: loan.excludedByCleanup,
        renewedDate: loan.renewedDate,
        finishedDate: loan.finishedDate,
        previousLoan: loan.previousLoan,
        cleanupDate: null,
      })
      loansByLocation.set(locationId, existing)
    }
    return loansByLocation
  }

  /**
   * Converts loan data to portfolio format
   */
  private convertToPortfolioLoans(
    loans: Array<{
      id: string
      signDate: Date
      requestedAmount: number | { toNumber(): number }
      totalDebtAcquired: number | { toNumber(): number }
      pendingAmountStored: number | { toNumber(): number }
      totalPaid: number | { toNumber(): number }
      badDebtDate: Date | null
      excludedByCleanup: string | null
      renewedDate: Date | null
      finishedDate: Date | null
      previousLoan: string | null
      loantypeRelation: { rate: number | { toNumber(): number }; weekDuration: number } | null
    }>
  ): LoanForPortfolio[] {
    return loans.map((loan) => ({
      id: loan.id,
      signDate: loan.signDate,
      requestedAmount: Number(loan.requestedAmount),
      totalDebt: Number(loan.totalDebtAcquired),
      pendingAmountStored: Number(loan.pendingAmountStored),
      totalPaid: Number(loan.totalPaid),
      rate: loan.loantypeRelation ? Number(loan.loantypeRelation.rate) : 0,
      weekDuration: loan.loantypeRelation?.weekDuration ?? 16,
      badDebtDate: loan.badDebtDate,
      excludedByCleanup: loan.excludedByCleanup,
      renewedDate: loan.renewedDate,
      finishedDate: loan.finishedDate,
      previousLoan: loan.previousLoan,
      cleanupDate: null,
    }))
  }

  /**
   * Counts borrowers in multiple locations (total count)
   */
  private async countBorrowersInLocations(locationIds: string[]): Promise<number> {
    return this.prisma.borrower.count({
      where: {
        personalDataRelation: {
          addresses: {
            some: { location: { in: locationIds } },
          },
        },
      },
    })
  }

  /**
   * Counts borrowers grouped by location ID.
   * Optimized to run a single query instead of N queries.
   * Returns a Map where key is locationId and value is borrower count.
   */
  private async countBorrowersGroupedByLocation(
    locationIds: string[]
  ): Promise<Map<string, number>> {
    // Use raw aggregation through address groupBy
    const addressCounts = await this.prisma.address.groupBy({
      by: ['location'],
      where: {
        location: { in: locationIds },
        personalDataRelation: {
          borrower: { isNot: null },
        },
      },
      _count: {
        personalData: true,
      },
    })

    const countMap = new Map<string, number>()
    for (const item of addressCounts) {
      countMap.set(item.location, item._count.personalData)
    }

    // Ensure all locationIds are in the map (with 0 if no borrowers)
    for (const id of locationIds) {
      if (!countMap.has(id)) {
        countMap.set(id, 0)
      }
    }

    return countMap
  }

  /**
   * Returns empty aggregated statistics
   */
  private getEmptyAggregatedStats(): AggregatedLocationStats {
    return {
      totalLocations: 0,
      totalClientes: 0,
      clientesActivos: 0,
      clientesEnCV: 0,
      clientesAlCorriente: 0,
      totalDistanceKm: 0,
    }
  }

  /**
   * Validates latitude and longitude coordinates
   */
  private validateCoordinates(latitude: number, longitude: number): void {
    if (latitude < -90 || latitude > 90) {
      throw new GraphQLError('Latitude must be between -90 and 90 degrees', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    if (longitude < -180 || longitude > 180) {
      throw new GraphQLError('Longitude must be between -180 and 180 degrees', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }
  }

  /**
   * Validates coordinates for multiple locations
   */
  private validateBatchCoordinates(inputs: UpdateLocationCoordinatesInput[]): void {
    for (const input of inputs) {
      if (input.latitude < -90 || input.latitude > 90) {
        throw new GraphQLError(
          `Invalid latitude for location ${input.locationId}: must be between -90 and 90 degrees`,
          { extensions: { code: 'BAD_USER_INPUT' } }
        )
      }

      if (input.longitude < -180 || input.longitude > 180) {
        throw new GraphQLError(
          `Invalid longitude for location ${input.locationId}: must be between -180 and 180 degrees`,
          { extensions: { code: 'BAD_USER_INPUT' } }
        )
      }
    }
  }

  /**
   * Verifies that all locations exist
   */
  private async verifyLocationsExist(locationIds: string[]): Promise<void> {
    const existingLocations = await this.prisma.location.findMany({
      where: { id: { in: locationIds } },
      select: { id: true },
    })

    const existingIds = new Set(existingLocations.map((l) => l.id))
    const missingIds = locationIds.filter((id) => !existingIds.has(id))

    if (missingIds.length > 0) {
      throw new GraphQLError(`Locations not found: ${missingIds.join(', ')}`, {
        extensions: { code: 'NOT_FOUND' },
      })
    }
  }

  /**
   * Gets all locations for a route with their client statistics.
   * Uses the same CV calculation logic as the portfolio report.
   *
   * IMPORTANT: Uses LocationHistoryService to determine which locations belong
   * to the route at the current date, matching the logic used in portfolio reports.
   *
   * @param routeId - Route ID to get locations for
   * @returns Array of locations with planning statistics
   */
  async getLocationsWithStats(routeId: string): Promise<LocationPlanningStats[]> {
    await this.verifyRouteExists(routeId)

    // Use LocationHistoryService to get locations that are currently assigned to this route
    // This matches the logic used in portfolio reports (/reporte/cartera -> por ruta)
    const today = new Date()
    const locations = await this.locationHistoryService.getLocationsInRouteAtDate(routeId, today)

    // Sort by name for consistent ordering
    locations.sort((a, b) => a.name.localeCompare(b.name))

    if (locations.length === 0) {
      return []
    }

    const locationIds = locations.map((loc) => loc.id)
    const activeWeek = this.getCurrentActiveWeek()

    // Fetch all data in parallel to minimize round trips
    const [loans, borrowerCounts] = await Promise.all([
      this.fetchActiveLoansForLocations(locationIds),
      this.countBorrowersGroupedByLocation(locationIds),
    ])

    const loanIds = loans.map((loan) => loan.id)
    const payments = await this.fetchPaymentsForLoans(loanIds)
    const paymentsMap = this.groupPaymentsByLoan(payments)
    const loansByLocation = this.groupLoansByLocation(loans)

    // Build results without N+1 queries
    return locations.map((location) => {
      const locationLoans = loansByLocation.get(location.id) || []
      const stats = countClientsStatus(locationLoans, paymentsMap, activeWeek)

      return {
        locationId: location.id,
        locationName: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        totalClientes: borrowerCounts.get(location.id) ?? 0,
        clientesActivos: stats.totalActivos,
        clientesEnCV: stats.enCV,
        clientesAlCorriente: stats.alCorriente,
      }
    })
  }

  /**
   * Gets all locations from multiple routes (or all routes if none specified).
   * Each location includes route info for color-coding on the map.
   *
   * @param routeIds - Optional array of route IDs to filter (null/empty = all routes)
   * @returns Array of locations with planning statistics and route info
   */
  async getAllLocationsWithStats(
    routeIds?: string[] | null
  ): Promise<LocationPlanningStatsWithRoute[]> {
    const today = new Date()

    // Get all routes or filter by IDs
    const routes = await this.prisma.route.findMany({
      where: routeIds && routeIds.length > 0 ? { id: { in: routeIds } } : undefined,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    if (routes.length === 0) {
      return []
    }

    // Get locations for each route using LocationHistoryService
    const routeLocationsMap = new Map<string, { routeId: string; routeName: string; locations: Array<{ id: string; name: string; latitude: number | null; longitude: number | null }> }>()

    for (const route of routes) {
      const locations = await this.locationHistoryService.getLocationsInRouteAtDate(route.id, today)
      routeLocationsMap.set(route.id, {
        routeId: route.id,
        routeName: route.name,
        locations,
      })
    }

    // Collect all unique location IDs
    const allLocationIds = new Set<string>()
    for (const routeData of routeLocationsMap.values()) {
      for (const loc of routeData.locations) {
        allLocationIds.add(loc.id)
      }
    }

    const locationIds = Array.from(allLocationIds)
    if (locationIds.length === 0) {
      return []
    }

    const activeWeek = this.getCurrentActiveWeek()

    // Fetch all data in parallel
    const [loans, borrowerCounts] = await Promise.all([
      this.fetchActiveLoansForLocations(locationIds),
      this.countBorrowersGroupedByLocation(locationIds),
    ])

    const loanIds = loans.map((loan) => loan.id)
    const payments = await this.fetchPaymentsForLoans(loanIds)
    const paymentsMap = this.groupPaymentsByLoan(payments)
    const loansByLocation = this.groupLoansByLocation(loans)

    // Build results with route info
    const results: LocationPlanningStatsWithRoute[] = []

    for (const routeData of routeLocationsMap.values()) {
      for (const location of routeData.locations) {
        const locationLoans = loansByLocation.get(location.id) || []
        const stats = countClientsStatus(locationLoans, paymentsMap, activeWeek)

        results.push({
          locationId: location.id,
          locationName: location.name,
          latitude: location.latitude,
          longitude: location.longitude,
          totalClientes: borrowerCounts.get(location.id) ?? 0,
          clientesActivos: stats.totalActivos,
          clientesEnCV: stats.enCV,
          clientesAlCorriente: stats.alCorriente,
          routeId: routeData.routeId,
          routeName: routeData.routeName,
        })
      }
    }

    // Sort by route name, then location name
    results.sort((a, b) => {
      const routeCompare = a.routeName.localeCompare(b.routeName)
      if (routeCompare !== 0) return routeCompare
      return a.locationName.localeCompare(b.locationName)
    })

    return results
  }

  /**
   * Gets aggregated statistics for a list of locations.
   * Calculates totals and distance between locations.
   *
   * @param locationIds - Array of location IDs
   * @returns Aggregated statistics
   */
  async getAggregatedStats(locationIds: string[]): Promise<AggregatedLocationStats> {
    if (locationIds.length === 0) {
      return this.getEmptyAggregatedStats()
    }

    const locations = await this.prisma.location.findMany({
      where: { id: { in: locationIds } },
      select: { id: true, latitude: true, longitude: true },
    })

    const orderedLocations = locationIds
      .map((id) => locations.find((loc) => loc.id === id))
      .filter(Boolean) as typeof locations

    const activeWeek = this.getCurrentActiveWeek()
    const loans = await this.fetchActiveLoansForLocations(locationIds)
    const loanIds = loans.map((loan) => loan.id)
    const payments = await this.fetchPaymentsForLoans(loanIds)
    const paymentsMap = this.groupPaymentsByLoan(payments)
    const portfolioLoans = this.convertToPortfolioLoans(loans)
    const stats = countClientsStatus(portfolioLoans, paymentsMap, activeWeek)
    const totalClientes = await this.countBorrowersInLocations(locationIds)
    const totalDistanceKm = calculateTotalDistance(orderedLocations)

    return {
      totalLocations: locations.length,
      totalClientes,
      clientesActivos: stats.totalActivos,
      clientesEnCV: stats.enCV,
      clientesAlCorriente: stats.alCorriente,
      totalDistanceKm,
    }
  }

  /**
   * Updates the GPS coordinates for a single location.
   *
   * @param input - Location ID and new coordinates
   * @returns Updated location
   */
  async updateLocationCoordinates(input: UpdateLocationCoordinatesInput): Promise<Location> {
    const existing = await this.prisma.location.findUnique({
      where: { id: input.locationId },
    })

    if (!existing) {
      throw new GraphQLError('Location not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    this.validateCoordinates(input.latitude, input.longitude)

    return this.prisma.location.update({
      where: { id: input.locationId },
      data: {
        latitude: input.latitude,
        longitude: input.longitude,
      },
    })
  }

  /**
   * Updates GPS coordinates for multiple locations in a batch.
   *
   * @param inputs - Array of location IDs and coordinates
   * @returns Array of updated locations
   */
  async batchUpdateLocationCoordinates(
    inputs: UpdateLocationCoordinatesInput[]
  ): Promise<Location[]> {
    if (inputs.length === 0) {
      return []
    }

    this.validateBatchCoordinates(inputs)
    await this.verifyLocationsExist(inputs.map((i) => i.locationId))

    const updatedLocations = await this.prisma.$transaction(
      inputs.map((input) =>
        this.prisma.location.update({
          where: { id: input.locationId },
          data: {
            latitude: input.latitude,
            longitude: input.longitude,
          },
        })
      )
    )

    return updatedLocations
  }
}
