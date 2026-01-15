import type { GraphQLContext } from '@solufacil/graphql-schema'
import { authenticateUser } from '../middleware/auth'
import {
  RoutePlanningService,
  type UpdateLocationCoordinatesInput,
} from '../services/RoutePlanningService'

const createService = (context: GraphQLContext): RoutePlanningService => {
  authenticateUser(context)
  return new RoutePlanningService(context.prisma)
}

export const routePlanningResolvers = {
  Query: {
    /**
     * Gets all locations for a route with their client statistics.
     * Used for displaying locations on the route planning map.
     *
     * @param routeId - Route ID to get locations for
     * @returns Array of locations with planning statistics
     */
    locationsForPlanning: async (
      _parent: unknown,
      args: { routeId: string },
      context: GraphQLContext
    ) => {
      const service = createService(context)
      return service.getLocationsWithStats(args.routeId)
    },

    /**
     * Gets all locations from multiple routes (or all routes if none specified).
     * Each location includes route info for color-coding on the map.
     *
     * @param routeIds - Optional array of route IDs to filter (null/empty = all routes)
     * @returns Array of locations with planning statistics and route info
     */
    allLocationsForPlanning: async (
      _parent: unknown,
      args: { routeIds?: string[] | null },
      context: GraphQLContext
    ) => {
      const service = createService(context)
      return service.getAllLocationsWithStats(args.routeIds)
    },

    /**
     * Gets aggregated statistics for a list of selected locations.
     * Used for showing totals and distance when multiple locations are selected.
     *
     * @param locationIds - Array of location IDs
     * @returns Aggregated statistics including total distance
     */
    aggregatedLocationStats: async (
      _parent: unknown,
      args: { locationIds: string[] },
      context: GraphQLContext
    ) => {
      const service = createService(context)
      return service.getAggregatedStats(args.locationIds)
    },
  },

  Mutation: {
    /**
     * Updates GPS coordinates for a single location.
     * Used when the user sets coordinates from the map.
     *
     * @param input - Location ID and new coordinates
     * @returns Updated location
     */
    updateLocationCoordinates: async (
      _parent: unknown,
      args: { input: UpdateLocationCoordinatesInput },
      context: GraphQLContext
    ) => {
      const service = createService(context)
      return service.updateLocationCoordinates(args.input)
    },

    /**
     * Updates GPS coordinates for multiple locations in a batch.
     * Used when importing coordinates from an external source.
     *
     * @param inputs - Array of location IDs and coordinates
     * @returns Array of updated locations
     */
    batchUpdateLocationCoordinates: async (
      _parent: unknown,
      args: { inputs: UpdateLocationCoordinatesInput[] },
      context: GraphQLContext
    ) => {
      const service = createService(context)
      return service.batchUpdateLocationCoordinates(args.inputs)
    },
  },
}
