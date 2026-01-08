import type { GraphQLContext } from '@solufacil/graphql-schema'
import {
  LocationHistoryService,
  LocationRouteHistoryInput,
  BatchChangeLocationRouteInput,
  BatchUpsertHistoricalInput,
} from '../services/LocationHistoryService'
import { authenticateUser } from '../middleware/auth'

export interface LocationRouteHistoryParent {
  id: string
  locationId: string
  routeId: string
  startDate: Date
  endDate: Date | null
  createdAt: Date
  location?: unknown
  route?: unknown
}

export interface LocationParent {
  id: string
  route?: string | null
  routeRelation?: unknown
}

export const locationHistoryResolvers = {
  Query: {
    locationRouteHistory: async (
      _parent: unknown,
      args: { locationId: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new LocationHistoryService(context.prisma)
      return service.getLocationHistory(args.locationId)
    },

    locationsInRouteAtDate: async (
      _parent: unknown,
      args: { routeId: string; date: Date },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new LocationHistoryService(context.prisma)
      return service.getLocationsInRouteAtDate(args.routeId, args.date)
    },

    routeForLocationAtDate: async (
      _parent: unknown,
      args: { locationId: string; date: Date },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new LocationHistoryService(context.prisma)
      const routeId = await service.getRouteForLocationAtDate(args.locationId, args.date)
      if (!routeId) return null

      return context.prisma.route.findUnique({
        where: { id: routeId },
      })
    },
  },

  Mutation: {
    changeLocationRoute: async (
      _parent: unknown,
      args: { locationId: string; routeId: string; effectiveDate: Date },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new LocationHistoryService(context.prisma)
      return service.changeLocationRoute(args.locationId, args.routeId, args.effectiveDate)
    },

    addLocationRouteHistory: async (
      _parent: unknown,
      args: { input: LocationRouteHistoryInput },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new LocationHistoryService(context.prisma)
      return service.upsertHistoricalAssignment(args.input)
    },

    updateLocationRouteHistory: async (
      _parent: unknown,
      args: { id: string; input: LocationRouteHistoryInput },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new LocationHistoryService(context.prisma)
      return service.updateHistoricalAssignment(args.id, args.input)
    },

    deleteLocationRouteHistory: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new LocationHistoryService(context.prisma)
      await service.deleteHistoricalAssignment(args.id)
      return true
    },

    batchChangeLocationRoutes: async (
      _parent: unknown,
      args: { input: BatchChangeLocationRouteInput },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new LocationHistoryService(context.prisma)
      return service.batchChangeLocationRoutes({
        locationIds: args.input.locationIds,
        newRouteId: args.input.newRouteId,
        effectiveDate: new Date(args.input.effectiveDate),
      })
    },

    batchUpsertHistoricalAssignment: async (
      _parent: unknown,
      args: { input: BatchUpsertHistoricalInput },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new LocationHistoryService(context.prisma)
      return service.batchUpsertHistoricalAssignment({
        locationIds: args.input.locationIds,
        routeId: args.input.routeId,
        startDate: new Date(args.input.startDate),
        endDate: new Date(args.input.endDate),
      })
    },
  },

  // Field resolvers for LocationRouteHistory type
  LocationRouteHistory: {
    location: async (
      parent: LocationRouteHistoryParent,
      _args: unknown,
      context: GraphQLContext
    ) => {
      // If relation is already included, return it
      if (parent.location) return parent.location

      return context.prisma.location.findUnique({
        where: { id: parent.locationId },
        include: {
          municipalityRelation: {
            include: {
              stateRelation: true,
            },
          },
        },
      })
    },

    route: async (
      parent: LocationRouteHistoryParent,
      _args: unknown,
      context: GraphQLContext
    ) => {
      // If relation is already included, return it
      if (parent.route) return parent.route

      return context.prisma.route.findUnique({
        where: { id: parent.routeId },
      })
    },
  },

  // Extend Location type resolvers
  LocationExtensions: {
    routeHistory: async (
      parent: LocationParent,
      _args: unknown,
      context: GraphQLContext
    ) => {
      return context.prisma.locationRouteHistory.findMany({
        where: { locationId: parent.id },
        orderBy: { startDate: 'desc' },
      })
    },

    currentRouteId: async (
      parent: LocationParent,
      _args: unknown,
      context: GraphQLContext
    ) => {
      const service = new LocationHistoryService(context.prisma)
      return service.getCurrentRoute(parent.id)
    },
  },
}
