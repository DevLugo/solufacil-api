import type { GraphQLContext } from '@solufacil/graphql-schema'
import { BorrowerService } from '../services/BorrowerService'
import { authenticateUser } from '../middleware/auth'

export const borrowerResolvers = {
  Query: {
    searchBorrowers: async (
      _parent: unknown,
      args: {
        searchTerm: string
        leadId?: string
        locationId?: string
        limit?: number
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const borrowerService = new BorrowerService(context.prisma)
      return borrowerService.searchByName({
        searchTerm: args.searchTerm,
        leadId: args.leadId,
        locationId: args.locationId,
        limit: args.limit,
      })
    },
  },

  Mutation: {
    createBorrower: async (
      _parent: unknown,
      args: {
        input: {
          personalData: {
            fullName: string
            clientCode?: string
            birthDate?: Date
            phones?: { number: string }[]
            addresses?: {
              street: string
              numberInterior?: string
              numberExterior?: string
              zipCode?: string
              locationId: string
            }[]
          }
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const borrowerService = new BorrowerService(context.prisma)
      return borrowerService.create(args.input)
    },

    updateBorrower: async (
      _parent: unknown,
      args: {
        id: string
        input: {
          personalData?: {
            fullName?: string
            birthDate?: Date
          }
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const borrowerService = new BorrowerService(context.prisma)
      return borrowerService.update(args.id, args.input)
    },
  },

  Borrower: {
    personalData: async (parent: { personalData: string; personalDataRelation?: unknown }, _args: unknown, context: GraphQLContext) => {
      // Si personalDataRelation ya está incluida, devolverla
      if (parent.personalDataRelation) {
        return parent.personalDataRelation
      }
      // Si no, buscarla
      return context.prisma.personalData.findUnique({
        where: { id: parent.personalData },
        include: {
          phones: true,
          addresses: {
            include: {
              locationRelation: {
                include: {
                  municipalityRelation: {
                    include: {
                      stateRelation: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
    },

    loans: async (parent: { id: string }, _args: unknown, context: GraphQLContext) => {
      return context.prisma.loan.findMany({
        where: { borrower: parent.id },
        orderBy: { signDate: 'desc' },
      })
    },
  },
}
