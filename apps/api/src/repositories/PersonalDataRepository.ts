import type { PrismaClient, Prisma } from '@solufacil/database'

export interface SearchPersonalDataOptions {
  searchTerm: string
  excludeBorrowerId?: string
  locationId?: string
  limit?: number
}

export class PersonalDataRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.personalData.findUnique({
      where: { id },
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
  }

  async search(options: SearchPersonalDataOptions) {
    const { searchTerm, excludeBorrowerId, locationId, limit = 10 } = options

    const where: Prisma.PersonalDataWhereInput = {
      fullName: {
        contains: searchTerm,
        mode: 'insensitive',
      },
    }

    // Excluir el PersonalData del borrower actual (para buscar avales)
    if (excludeBorrowerId) {
      where.borrower = {
        isNot: { id: excludeBorrowerId },
      }
    }

    const results = await this.prisma.personalData.findMany({
      where,
      take: limit * 2, // Obtenemos más para reordenar por localidad
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
        borrower: {
          select: { id: true },
        },
      },
      orderBy: { fullName: 'asc' },
    })

    // Reordenar: primero los de la localidad actual, luego los demás
    if (locationId) {
      const fromCurrentLocation: typeof results = []
      const fromOtherLocations: typeof results = []

      for (const pd of results) {
        const hasLocationMatch = pd.addresses.some(
          (addr) => addr.location === locationId
        )
        if (hasLocationMatch) {
          fromCurrentLocation.push(pd)
        } else {
          fromOtherLocations.push(pd)
        }
      }

      return [...fromCurrentLocation, ...fromOtherLocations].slice(0, limit)
    }

    return results.slice(0, limit)
  }

  async create(data: {
    fullName: string
    clientCode: string
    birthDate?: Date
    phones?: { number: string }[]
    addresses?: {
      street: string
      numberInterior?: string
      numberExterior?: string
      zipCode?: string
      locationId: string
    }[]
  }) {
    return this.prisma.personalData.create({
      data: {
        fullName: data.fullName,
        clientCode: data.clientCode,
        birthDate: data.birthDate,
        phones: data.phones ? { create: data.phones } : undefined,
        addresses: data.addresses
          ? {
              create: data.addresses.map((addr) => ({
                street: addr.street,
                interiorNumber: addr.numberInterior || '',
                exteriorNumber: addr.numberExterior || '',
                postalCode: addr.zipCode || '',
                location: addr.locationId,
              })),
            }
          : undefined,
      },
      include: {
        phones: true,
        addresses: {
          include: {
            locationRelation: true,
          },
        },
      },
    })
  }

  async updatePhone(personalDataId: string, phoneId: string | undefined, number: string) {
    if (phoneId) {
      // Actualizar teléfono existente
      return this.prisma.phone.update({
        where: { id: phoneId },
        data: { number },
      })
    } else {
      // Crear nuevo teléfono
      return this.prisma.phone.create({
        data: {
          number,
          personalData: personalDataId,
        },
      })
    }
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.prisma.personalData.count({
      where: { id },
    })
    return count > 0
  }

  async updateName(id: string, fullName: string) {
    return this.prisma.personalData.update({
      where: { id },
      data: { fullName },
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
  }
}
