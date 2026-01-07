import type { GraphQLContext } from '@solufacil/graphql-schema'
import { RouteService } from '../services/RouteService'
import { RouteManagementService } from '../services/RouteManagementService'
import { authenticateUser, requireRole } from '../middleware/auth'
import { resolvePersonalData } from './helpers/personalDataResolver'

export const routeResolvers = {
  Query: {
    route: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const routeService = new RouteService(context.prisma)
      return routeService.findById(args.id)
    },

    routes: async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
      authenticateUser(context)

      const routeService = new RouteService(context.prisma)
      return routeService.findMany()
    },

    routesWithStats: async (
      _parent: unknown,
      args: { year: number; month: number },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, ['ADMIN'])

      const routeManagementService = new RouteManagementService(context.prisma)
      return routeManagementService.getRoutesWithStats(args.year, args.month)
    },

    locations: async (
      _parent: unknown,
      args: { routeId?: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const routeService = new RouteService(context.prisma)
      return routeService.findLocations(args.routeId ?? undefined)
    },

    locationsCreatedInPeriod: async (
      _parent: unknown,
      args: { fromDate: Date; toDate: Date; routeId?: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      return context.prisma.location.findMany({
        where: {
          createdAt: {
            gte: args.fromDate,
            lte: args.toDate,
          },
          ...(args.routeId ? { route: args.routeId } : {}),
        },
        include: {
          routeRelation: true,
          municipalityRelation: {
            include: {
              stateRelation: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    },

    municipalities: async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
      authenticateUser(context)

      return context.prisma.municipality.findMany({
        orderBy: { name: 'asc' },
        include: {
          stateRelation: true
        }
      })
    },
  },

  Mutation: {
    createRoute: async (
      _parent: unknown,
      args: { input: { name: string } },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, ['ADMIN'])

      const routeService = new RouteService(context.prisma)
      return routeService.create(args.input)
    },

    updateRoute: async (
      _parent: unknown,
      args: {
        id: string
        input: { name?: string }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)
      requireRole(context, ['ADMIN'])

      const routeService = new RouteService(context.prisma)
      return routeService.update(args.id, args.input)
    },

    createLocation: async (
      _parent: unknown,
      args: { input: { name: string; municipalityId: string; routeId: string } },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      return context.prisma.location.create({
        data: {
          name: args.input.name,
          municipality: args.input.municipalityId,
          route: args.input.routeId
        },
        include: {
          municipalityRelation: {
            include: {
              stateRelation: true
            }
          }
        }
      })
    },
  },

  Route: {
    employees: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      const route = await context.prisma.route.findUnique({
        where: { id: parent.id },
        include: {
          employees: {
            include: {
              personalDataRelation: {
                include: {
                  addresses: {
                    include: {
                      locationRelation: true,
                    },
                  },
                  phones: true,
                },
              },
            },
          },
        },
      })
      return route?.employees || []
    },

    accounts: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      const route = await context.prisma.route.findUnique({
        where: { id: parent.id },
        include: { accounts: true },
      })
      return route?.accounts || []
    },

    transactions: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      // Read from AccountEntry through loans whose leads belong to this route
      const entries = await context.prisma.accountEntry.findMany({
        where: {
          loan: {
            leadRelation: {
              routes: {
                some: { id: parent.id },
              },
            },
          },
        },
        orderBy: { entryDate: 'desc' },
        take: 50,
      })
      // Return entries - the Transaction resolver will handle field mapping
      return entries.map(e => ({
        ...e,
        date: e.entryDate,
        sourceAccount: e.accountId,
        route: parent.id, // We know the route since we queried by it
        lead: e.snapshotLeadId,
      }))
    },

    locations: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.location.findMany({
        where: { route: parent.id },
        include: {
          municipalityRelation: {
            include: {
              stateRelation: true,
            },
          },
        },
      })
    },
  },

  Location: {
    route: async (parent: { route?: string; routeRelation?: unknown }, _args: unknown, context: GraphQLContext) => {
      if (parent.routeRelation) return parent.routeRelation
      if (!parent.route) return null
      return context.prisma.route.findUnique({
        where: { id: parent.route },
      })
    },

    municipality: async (parent: { municipality: string; municipalityRelation?: unknown }, _args: unknown, context: GraphQLContext) => {
      // If relation is already included, return it
      if (parent.municipalityRelation) return parent.municipalityRelation
      // Otherwise, fetch it
      return context.prisma.municipality.findUnique({
        where: { id: parent.municipality },
        include: {
          stateRelation: true,
        },
      })
    },

    addresses: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.address.findMany({
        where: { location: parent.id },
      })
    },
  },

  Municipality: {
    state: async (parent: { state: string; stateRelation?: unknown }, _args: unknown, context: GraphQLContext) => {
      // If relation is already included, return it
      if (parent.stateRelation) return parent.stateRelation
      // Otherwise, fetch it
      return context.prisma.state.findUnique({
        where: { id: parent.state },
      })
    },

    locations: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.location.findMany({
        where: { municipality: parent.id },
      })
    },
  },

  State: {
    municipalities: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.municipality.findMany({
        where: { state: parent.id },
      })
    },
  },

  EmployeeWithStats: {
    personalData: async (parent: { personalData: string | null; personalDataRelation?: { id: string | null } | null }, _args: unknown, context: GraphQLContext) => {
      return resolvePersonalData(parent, context)
    },
  },
}
