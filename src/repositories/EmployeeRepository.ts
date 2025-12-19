import type { PrismaClient, Employee, EmployeeType, Prisma } from '@solufacil/database'

export class EmployeeRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.employee.findUnique({
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
        routes: true,
        userRelation: true,
      },
    })
  }

  async findMany(options?: {
    type?: EmployeeType
    routeId?: string
  }) {
    return this.prisma.employee.findMany({
      where: {
        ...(options?.type ? { type: options.type } : {}),
        ...(options?.routeId
          ? { routes: { some: { id: options.routeId } } }
          : {}),
      },
      include: {
        personalDataRelation: {
          select: {
            id: true,
            fullName: true,
            clientCode: true,
            birthDate: true,
            phones: {
              select: {
                id: true,
                number: true,
              },
            },
            addresses: {
              include: {
                locationRelation: true,
              },
            },
          },
        },
        routes: {
          select: {
            id: true,
            name: true,
          },
        },
        userRelation: {
          select: {
            id: true,
          },
        },
        loansGranted: {
          select: {
            id: true,
            requestedAmount: true,
            amountGived: true,
            status: true,
            signDate: true,
            borrower: true,
          },
          orderBy: { signDate: 'desc' },
        },
        loansManagedAsLead: {
          select: {
            id: true,
            requestedAmount: true,
            amountGived: true,
            status: true,
            signDate: true,
            borrower: true,
          },
          orderBy: { signDate: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(data: {
    type: EmployeeType
    personalData: {
      fullName: string
      clientCode: string
      birthDate?: Date
      phones?: { number: string }[]
      addresses?: {
        street: string
        interiorNumber?: string
        exteriorNumber?: string
        postalCode?: string
        location: string
      }[]
    }
    routeIds?: string[]
  }) {
    return this.prisma.employee.create({
      data: {
        type: data.type,
        personalDataRelation: {
          create: {
            fullName: data.personalData.fullName,
            clientCode: data.personalData.clientCode,
            birthDate: data.personalData.birthDate,
            phones: data.personalData.phones
              ? { create: data.personalData.phones }
              : undefined,
            addresses: data.personalData.addresses
              ? { create: data.personalData.addresses }
              : undefined,
          },
        },
        routes: data.routeIds
          ? { connect: data.routeIds.map((id) => ({ id })) }
          : undefined,
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
        routes: true,
      },
    })
  }

  async update(
    id: string,
    data: {
      type?: EmployeeType
      routeIds?: string[]
    }
  ) {
    return this.prisma.employee.update({
      where: { id },
      data: {
        ...(data.type ? { type: data.type } : {}),
        ...(data.routeIds
          ? { routes: { set: data.routeIds.map((id) => ({ id })) } }
          : {}),
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
        routes: true,
      },
    })
  }

  async promoteToLead(id: string) {
    return this.prisma.employee.update({
      where: { id },
      data: { type: 'LEAD' },
      include: {
        personalDataRelation: true,
        routes: true,
      },
    })
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.prisma.employee.count({
      where: { id },
    })
    return count > 0
  }
}
