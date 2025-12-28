import type { PrismaClient, Borrower, Prisma } from '@solufacil/database'

export interface SearchBorrowersOptions {
  searchTerm: string
  leadId?: string
  locationId?: string
  limit?: number
}

export interface BorrowerSearchResultRaw {
  id: string
  loanFinishedCount: number
  personalData: string
  personalDataRelation: {
    id: string
    fullName: string
    clientCode: string
    birthDate: Date | null
    phones: { id: string; number: string }[]
    addresses: {
      id: string
      location: string
      locationRelation: {
        id: string
        name: string
        municipalityRelation: {
          id: string
          name: string
          stateRelation: { id: string; name: string }
        }
      }
    }[]
  }
  loans: { id: string; status: string; pendingAmountStored: string; renewedBy?: { id: string } | null }[]
  isFromCurrentLocation?: boolean
  locationId?: string
  locationName?: string
}

export class BorrowerRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.borrower.findUnique({
      where: { id },
      include: {
        personalDataRelation: {
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
        },
        loans: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    })
  }

  async findMany(options?: { limit?: number; offset?: number }) {
    return this.prisma.borrower.findMany({
      take: options?.limit,
      skip: options?.offset,
      include: {
        personalDataRelation: {
          include: {
            phones: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(data: {
    personalData: {
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
    }
  }) {
    return this.prisma.borrower.create({
      data: {
        personalDataRelation: {
          create: {
            fullName: data.personalData.fullName,
            clientCode: data.personalData.clientCode,
            birthDate: data.personalData.birthDate,
            phones: data.personalData.phones
              ? { create: data.personalData.phones }
              : undefined,
            addresses: data.personalData.addresses
              ? {
                  create: data.personalData.addresses.map((addr) => ({
                    street: addr.street,
                    interiorNumber: addr.numberInterior || '',
                    exteriorNumber: addr.numberExterior || '',
                    postalCode: addr.zipCode || '',
                    location: addr.locationId, // Map locationId to location FK field
                  })),
                }
              : undefined,
          },
        },
      },
      include: {
        personalDataRelation: {
          include: {
            phones: true,
            addresses: {
              include: {
                locationRelation: true,
              },
            },
          },
        },
      },
    })
  }

  async update(
    id: string,
    data: {
      personalData?: {
        fullName?: string
        birthDate?: Date
      }
    }
  ) {
    // Obtener el borrower para conseguir el personalData
    const borrower = await this.prisma.borrower.findUnique({
      where: { id },
      select: { personalData: true },
    })

    if (!borrower) {
      throw new Error('Borrower not found')
    }

    // Actualizar personalData si se proporciona
    if (data.personalData) {
      await this.prisma.personalData.update({
        where: { id: borrower.personalData },
        data: {
          ...(data.personalData.fullName
            ? { fullName: data.personalData.fullName }
            : {}),
          ...(data.personalData.birthDate
            ? { birthDate: data.personalData.birthDate }
            : {}),
        },
      })
    }

    return this.prisma.borrower.findUnique({
      where: { id },
      include: {
        personalDataRelation: {
          include: {
            phones: true,
            addresses: {
              include: {
                locationRelation: true,
              },
            },
          },
        },
      },
    })
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.prisma.borrower.count({
      where: { id },
    })
    return count > 0
  }

  async incrementLoanFinishedCount(id: string): Promise<void> {
    await this.prisma.borrower.update({
      where: { id },
      data: {
        loanFinishedCount: { increment: 1 },
      },
    })
  }

  async search(options: SearchBorrowersOptions): Promise<BorrowerSearchResultRaw[]> {
    const { searchTerm, leadId, locationId, limit = 10 } = options

    const where: Prisma.BorrowerWhereInput = {
      personalDataRelation: {
        fullName: {
          contains: searchTerm,
          mode: 'insensitive',
        },
      },
    }

    // Filtrar por lead si se especifica
    if (leadId) {
      where.loans = {
        some: {
          lead: leadId,
          status: 'ACTIVE',
        },
      }
    }

    const results = await this.prisma.borrower.findMany({
      where,
      take: limit * 2, // Obtenemos más para reordenar por localidad
      include: {
        personalDataRelation: {
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
        },
        loans: {
          select: {
            id: true,
            status: true,
            pendingAmountStored: true,
            // Verificar si el préstamo ya fue renovado (tiene otro préstamo que lo referencia como previousLoan)
            renewedBy: {
              select: { id: true },
            },
            // Incluir lead para obtener la localidad del préstamo
            leadRelation: {
              select: {
                personalDataRelation: {
                  select: {
                    addresses: {
                      select: {
                        location: true,
                        locationRelation: {
                          select: {
                            id: true,
                            name: true,
                          },
                        },
                      },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: {
        personalDataRelation: { fullName: 'asc' },
      },
    })

    // Agregar información de localidad y reordenar
    const enrichedResults: BorrowerSearchResultRaw[] = results.map((borrower) => {
      // Primero intentar obtener la localidad del borrower directamente de su address
      const borrowerAddresses = borrower.personalDataRelation?.addresses || []
      const primaryBorrowerAddress = borrowerAddresses.find((addr) => addr.locationRelation?.name)

      let finalLocationId: string | undefined = primaryBorrowerAddress?.location
      let finalLocationName: string | undefined = primaryBorrowerAddress?.locationRelation?.name

      // Si el borrower no tiene localidad propia, obtenerla del lead de su préstamo más reciente
      if (!finalLocationId && borrower.loans.length > 0) {
        for (const loan of borrower.loans) {
          const leadRelation = (loan as any).leadRelation
          const leadAddress = leadRelation?.personalDataRelation?.addresses?.[0]

          // Debug logging
          if (process.env.DEBUG_LOCATION === 'true') {
            console.log(`[BorrowerRepository] Borrower: ${borrower.personalDataRelation?.fullName}`)
            console.log(`  - Loan ID: ${loan.id}`)
            console.log(`  - leadRelation exists: ${!!leadRelation}`)
            console.log(`  - leadAddress: ${JSON.stringify(leadAddress)}`)
          }

          if (leadAddress?.location) {
            finalLocationId = leadAddress.location
            finalLocationName = leadAddress.locationRelation?.name
            break
          }
        }
      }

      // Determinar si es de la localidad actual:
      // - Si no se pasa locationId en la búsqueda, siempre es true
      // - Si no se pudo determinar la location del borrower, asumimos true (no mostrar warning)
      // - Si sí hay location del borrower, comparamos con el locationId buscado
      const isFromCurrentLocation = !locationId || !finalLocationId || finalLocationId === locationId

      // Debug logging
      if (process.env.DEBUG_LOCATION === 'true') {
        console.log(`[BorrowerRepository] Final result for ${borrower.personalDataRelation?.fullName}:`)
        console.log(`  - finalLocationId: ${finalLocationId}`)
        console.log(`  - finalLocationName: ${finalLocationName}`)
        console.log(`  - searchLocationId: ${locationId}`)
        console.log(`  - isFromCurrentLocation: ${isFromCurrentLocation}`)
      }

      return {
        ...borrower,
        loans: borrower.loans.map(loan => ({
          ...loan,
          pendingAmountStored: loan.pendingAmountStored.toString(),
          status: loan.status as string,
        })),
        isFromCurrentLocation,
        locationId: finalLocationId,
        locationName: finalLocationName,
      } as BorrowerSearchResultRaw
    })

    // Reordenar: primero los de la localidad actual, luego los demás
    if (locationId) {
      const fromCurrentLocation: BorrowerSearchResultRaw[] = []
      const fromOtherLocations: BorrowerSearchResultRaw[] = []

      for (const borrower of enrichedResults) {
        if (borrower.isFromCurrentLocation) {
          fromCurrentLocation.push(borrower)
        } else {
          fromOtherLocations.push(borrower)
        }
      }

      return [...fromCurrentLocation, ...fromOtherLocations].slice(0, limit)
    }

    return enrichedResults.slice(0, limit)
  }
}
