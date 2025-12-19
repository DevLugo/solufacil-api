import { GraphQLError } from 'graphql'
import type { PrismaClient } from '@solufacil/database'
import { RouteRepository } from '../repositories/RouteRepository'

export interface CreateRouteInput {
  name: string
}

export interface UpdateRouteInput {
  name?: string
}

export class RouteService {
  private routeRepository: RouteRepository

  constructor(prisma: PrismaClient) {
    this.routeRepository = new RouteRepository(prisma)
  }

  async findById(id: string) {
    const route = await this.routeRepository.findById(id)
    if (!route) {
      throw new GraphQLError('Route not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }
    return route
  }

  async findMany() {
    return this.routeRepository.findMany()
  }

  async create(input: CreateRouteInput) {
    return this.routeRepository.create(input)
  }

  async update(id: string, input: UpdateRouteInput) {
    const exists = await this.routeRepository.exists(id)
    if (!exists) {
      throw new GraphQLError('Route not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    return this.routeRepository.update(id, input)
  }

  async findLocations(routeId?: string) {
    return this.routeRepository.findLocations(routeId)
  }
}
