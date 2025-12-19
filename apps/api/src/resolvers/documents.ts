import { GraphQLError } from 'graphql'
import type { GraphQLContext } from '../context'
import { DocumentType, UserRole } from '@solufacil/database'
import { DocumentPhotoService } from '../services/DocumentPhotoService'
import { authenticateUser, requireAnyRole } from '../middleware/auth'

export const documentResolvers = {
  Query: {
    documentPhotos: async (
      _parent: unknown,
      args: {
        loanId?: string
        personalDataId?: string
        documentType?: DocumentType
        hasErrors?: boolean
        limit?: number
        offset?: number
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new DocumentPhotoService(context.prisma)
      return service.findMany({
        loanId: args.loanId,
        personalDataId: args.personalDataId,
        documentType: args.documentType,
        hasErrors: args.hasErrors,
        limit: args.limit,
        offset: args.offset,
      })
    },

    documentPhoto: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      const service = new DocumentPhotoService(context.prisma)
      return service.findById(args.id)
    },

    documentsWithErrors: async (
      _parent: unknown,
      args: { routeId?: string },
      context: GraphQLContext
    ) => {
      const service = new DocumentPhotoService(context.prisma)
      return service.findWithErrors(args.routeId)
    },
  },

  Mutation: {
    uploadDocumentPhoto: async (
      _parent: unknown,
      args: {
        input: {
          title?: string
          description?: string
          documentType: DocumentType
          file: Promise<{
            createReadStream: () => NodeJS.ReadableStream
            filename: string
            mimetype: string
          }>
          personalDataId?: string
          loanId?: string
          isError?: boolean
          errorDescription?: string
          isMissing?: boolean
        }
      },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN, UserRole.DOCUMENT_REVIEWER])

      const file = await args.input.file
      const service = new DocumentPhotoService(context.prisma)

      return service.upload(
        {
          title: args.input.title,
          description: args.input.description,
          documentType: args.input.documentType,
          file: file as any,
          personalDataId: args.input.personalDataId,
          loanId: args.input.loanId,
          isError: args.input.isError,
          errorDescription: args.input.errorDescription,
          isMissing: args.input.isMissing,
        },
        context.user!.id
      )
    },

    updateDocumentPhoto: async (
      _parent: unknown,
      args: {
        id: string
        input: {
          title?: string
          description?: string
          isError?: boolean
          errorDescription?: string
          isMissing?: boolean
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new DocumentPhotoService(context.prisma)
      return service.update(args.id, args.input)
    },

    deleteDocumentPhoto: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new DocumentPhotoService(context.prisma)
      return service.delete(args.id)
    },

    markDocumentAsMissing: async (
      _parent: unknown,
      args: {
        input: {
          loanId: string
          personalDataId: string
          documentType: DocumentType
        }
      },
      context: GraphQLContext
    ) => {
      authenticateUser(context)

      const service = new DocumentPhotoService(context.prisma)
      return service.markAsMissing(
        args.input.loanId,
        args.input.personalDataId,
        args.input.documentType,
        context.user!.id
      )
    },
  },

  DocumentPhoto: {
    personalData: async (parent: any, _args: unknown, context: GraphQLContext) => {
      // In Prisma schema, the field is called 'personalData' (not 'personalDataId')
      const personalDataId = parent.personalData || parent.personalDataId
      if (!personalDataId) return null

      // If already included from repository, return it
      if (parent.personalDataRelation) return parent.personalDataRelation

      return context.prisma.personalData.findUnique({
        where: { id: personalDataId },
        include: {
          phones: true,
          addresses: {
            include: {
              locationRelation: true,
            },
          },
        },
      })
    },

    loan: async (parent: any, _args: unknown, context: GraphQLContext) => {
      // In Prisma schema, the field is called 'loan' (not 'loanId')
      const loanId = parent.loan || parent.loanId
      if (!loanId) return null

      // If already included from repository, return it
      if (parent.loanRelation) return parent.loanRelation

      return context.prisma.loan.findUnique({
        where: { id: loanId },
        include: {
          borrowerRelation: {
            include: {
              personalDataRelation: true,
            },
          },
          collaterals: true,
          loantypeRelation: true,
        },
      })
    },

    uploadedBy: async (parent: any, _args: unknown, context: GraphQLContext) => {
      const uploadedById = parent.uploadedBy || parent.uploadedById
      if (!uploadedById) return null

      // If already included from repository, return it
      if (parent.uploadedByRelation) return parent.uploadedByRelation

      return context.prisma.user.findUnique({
        where: { id: uploadedById },
      })
    },
  },
}
