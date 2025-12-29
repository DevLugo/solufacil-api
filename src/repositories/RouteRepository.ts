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
    console.log('[RouteRepository.findLocations] routeId:', routeId)

    if (!routeId) {
      // Return all locations if no routeId specified
      return this.prisma.location.findMany({
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

    // Get locations associated with this route OR used by leads of this route
    // First, get locations directly associated with the route
    const directLocations = await this.prisma.location.findMany({
      where: { route: routeId },
      include: {
        municipalityRelation: {
          include: {
            stateRelation: true,
          },
        },
        routeRelation: true,
      },
    })
    console.log('[RouteRepository.findLocations] directLocations count:', directLocations.length)

    // Then, get locations from addresses of leads in this route
    const leadsLocations = await this.prisma.location.findMany({
      where: {
        addresses: {
          some: {
            personalDataRelation: {
              employee: {
                routes: {
                  some: { id: routeId },
                },
              },
            },
          },
        },
      },
      include: {
        municipalityRelation: {
          include: {
            stateRelation: true,
          },
        },
        routeRelation: true,
      },
    })
    console.log('[RouteRepository.findLocations] leadsLocations count:', leadsLocations.length, leadsLocations.map(l => l.name))

    // Combine and deduplicate by id
    const allLocations = [...directLocations, ...leadsLocations]
    const uniqueLocations = allLocations.filter(
      (loc, index, self) => self.findIndex((l) => l.id === loc.id) === index
    )

    console.log('[RouteRepository.findLocations] uniqueLocations count:', uniqueLocations.length)

    // Sort by name
    return uniqueLocations.sort((a, b) => a.name.localeCompare(b.name))
  }
}
