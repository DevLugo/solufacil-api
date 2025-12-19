import type { PrismaClient, Route, Prisma } from '@solufacil/database'

export class RouteRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.route.findUnique({
      where: { id },
      include: {
        employees: {
          include: {
            personalDataRelation: true,
          },
        },
        accounts: true,
        locations: {
          include: {
            municipalityRelation: {
              include: {
                stateRelation: true,
              },
            },
          },
        },
      },
    })
  }

  async findMany() {
    return this.prisma.route.findMany({
      include: {
        employees: {
          include: {
            personalDataRelation: true,
          },
        },
        accounts: true,
        locations: true,
      },
      orderBy: { name: 'asc' },
    })
  }

  async create(data: { name: string }) {
    return this.prisma.route.create({
      data: {
        name: data.name,
      },
      include: {
        employees: true,
        accounts: true,
        locations: true,
      },
    })
  }

  async update(
    id: string,
    data: {
      name?: string
    }
  ) {
    return this.prisma.route.update({
      where: { id },
      data,
      include: {
        employees: true,
        accounts: true,
        locations: true,
      },
    })
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.prisma.route.count({
      where: { id },
    })
    return count > 0
  }

  async findLocations(routeId?: string) {
    return this.prisma.location.findMany({
      where: routeId ? { route: routeId } : undefined,
      include: {
        municipalityRelation: {
          include: {
            stateRelation: true,
          },
        },
        routeRelation: true,
      },
      orderBy: { name: 'asc' },
    })
  }
}
