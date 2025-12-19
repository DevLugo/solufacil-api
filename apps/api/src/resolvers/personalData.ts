import type { GraphQLContext } from '@solufacil/graphql-schema'
import { PersonalDataService } from '../services/PersonalDataService'
import { authenticateUser } from '../middleware/auth'

// Resolver para mapear campos de Prisma a GraphQL para PersonalData y Address
export const personalDataResolvers = {
  Query: {
    searchPersonalData: async (
      _parent: unknown,
      args: {
        searchTerm: string
        excludeBorrowerId?: string
        locationId?: string
        limit?: number
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const personalDataService = new PersonalDataService(context.prisma)
      return personalDataService.search({
        searchTerm: args.searchTerm,
        excludeBorrowerId: args.excludeBorrowerId,
        locationId: args.locationId,
        limit: args.limit,
      })
    },
  },

  Mutation: {
    updatePersonalData: async (
      _parent: unknown,
      args: {
        id: string
        fullName: string
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const personalDataService = new PersonalDataService(context.prisma)
      return personalDataService.updateName(args.id, args.fullName)
    },

    updatePhone: async (
      _parent: unknown,
      args: {
        input: {
          personalDataId: string
          phoneId?: string
          number: string
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const personalDataService = new PersonalDataService(context.prisma)
      return personalDataService.updatePhone(args.input)
    },
  },

  PersonalData: {
    // Resolver para addresses que retorna array vacío si es null
    addresses: (parent: { addresses?: unknown[] | null }) => {
      return parent.addresses ?? []
    },

    // Resolver para phones que retorna array vacío si es null
    phones: (parent: { phones?: unknown[] | null }) => {
      return parent.phones ?? []
    },

    employee: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.employee.findFirst({
        where: { personalData: parent.id },
      })
    },

    borrower: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.borrower.findFirst({
        where: { personalData: parent.id },
      })
    },
  },

  Address: {
    // Mapear locationRelation de Prisma a location de GraphQL
    location: async (parent: { locationRelation?: unknown; location?: string }, _args: unknown, context: GraphQLContext) => {
      // Si locationRelation ya está incluido, devolverlo
      if (parent.locationRelation) {
        return parent.locationRelation
      }
      // Si no está incluido pero tenemos el ID, buscarlo
      if (parent.location) {
        return context.prisma.location.findUnique({
          where: { id: parent.location },
          include: {
            municipalityRelation: {
              include: {
                stateRelation: true,
              },
            },
          },
        })
      }
      // No debería llegar aquí ya que location es requerido
      return null
    },

    personalData: async (parent: { personalData: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.personalData.findUnique({
        where: { id: parent.personalData },
      })
    },
  },

  Phone: {
    personalData: async (parent: { personalData: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.personalData.findUnique({
        where: { id: parent.personalData },
      })
    },
  },
}
