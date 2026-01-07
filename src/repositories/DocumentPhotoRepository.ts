import type { PrismaClient, DocumentType, Prisma } from '@solufacil/database'

export class DocumentPhotoRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.documentPhoto.findUnique({
      where: { id },
      include: {
        personalDataRelation: true,
        loanRelation: {
          include: {
            borrowerRelation: {
              include: {
                personalDataRelation: true,
              },
            },
          },
        },
        uploadedByRelation: true,
      },
    })
  }

  async findMany(options?: {
    loanId?: string
    personalDataId?: string
    documentType?: DocumentType
    hasErrors?: boolean
    isMissing?: boolean
    limit?: number
    offset?: number
  }) {
    const where: Prisma.DocumentPhotoWhereInput = {}

    if (options?.loanId) {
      where.loan = options.loanId
    }

    if (options?.personalDataId) {
      where.personalData = options.personalDataId
    }

    if (options?.documentType) {
      where.documentType = options.documentType
    }

    if (options?.hasErrors !== undefined) {
      where.isError = options.hasErrors
    }

    if (options?.isMissing !== undefined) {
      where.isMissing = options.isMissing
    }

    return this.prisma.documentPhoto.findMany({
      where,
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
      orderBy: { createdAt: 'desc' },
      include: {
        personalDataRelation: true,
        loanRelation: {
          include: {
            borrowerRelation: {
              include: {
                personalDataRelation: true,
              },
            },
          },
        },
        uploadedByRelation: true,
      },
    })
  }

  async create(data: {
    photoUrl: string
    publicId: string
    documentType: DocumentType
    title?: string
    description?: string
    personalDataId?: string
    loanId?: string
    uploadedById: string
    isError?: boolean
    errorDescription?: string
    isMissing?: boolean
  }) {
    return this.prisma.documentPhoto.create({
      data: {
        photoUrl: data.photoUrl,
        publicId: data.publicId,
        documentType: data.documentType,
        title: data.title,
        description: data.description,
        personalData: data.personalDataId,
        loan: data.loanId,
        uploadedBy: data.uploadedById,
        isError: data.isError ?? false,
        errorDescription: data.errorDescription,
        isMissing: data.isMissing ?? false,
      },
      include: {
        personalDataRelation: true,
        loanRelation: true,
        uploadedByRelation: true,
      },
    })
  }

  async update(
    id: string,
    data: {
      photoUrl?: string
      publicId?: string
      title?: string
      description?: string
      isError?: boolean
      errorDescription?: string
      isMissing?: boolean
    }
  ) {
    return this.prisma.documentPhoto.update({
      where: { id },
      data,
      include: {
        personalDataRelation: true,
        loanRelation: true,
        uploadedByRelation: true,
      },
    })
  }

  async delete(id: string) {
    return this.prisma.documentPhoto.delete({
      where: { id },
    })
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.prisma.documentPhoto.count({
      where: { id },
    })
    return count > 0
  }

  async findWithErrors(options?: { routeId?: string }) {
    return this.prisma.documentPhoto.findMany({
      where: {
        OR: [{ isError: true }, { isMissing: true }],
        ...(options?.routeId
          ? {
              loanRelation: {
                leadRelation: {
                  routes: {
                    some: { id: options.routeId },
                  },
                },
              },
            }
          : {}),
      },
      include: {
        personalDataRelation: true,
        loanRelation: {
          include: {
            borrowerRelation: {
              include: {
                personalDataRelation: true,
              },
            },
            leadRelation: {
              include: {
                personalDataRelation: true,
                routes: true,
              },
            },
          },
        },
        uploadedByRelation: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  }
}
