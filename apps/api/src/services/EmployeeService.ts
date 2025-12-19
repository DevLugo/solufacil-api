import { GraphQLError } from 'graphql'
import type { PrismaClient, EmployeeType } from '@solufacil/database'
import { EmployeeRepository } from '../repositories/EmployeeRepository'
import { generateClientCode } from '@solufacil/shared'

export interface CreateEmployeeInput {
  type: EmployeeType
  personalData: {
    fullName: string
    clientCode?: string
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
}

export interface UpdateEmployeeInput {
  type?: EmployeeType
  routeIds?: string[]
}

export class EmployeeService {
  private employeeRepository: EmployeeRepository

  constructor(private prisma: PrismaClient) {
    this.employeeRepository = new EmployeeRepository(prisma)
  }

  async findById(id: string) {
    const employee = await this.employeeRepository.findById(id)
    if (!employee) {
      throw new GraphQLError('Employee not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }
    return employee
  }

  async findMany(options?: {
    type?: EmployeeType
    routeId?: string
  }) {
    return this.employeeRepository.findMany(options)
  }

  async create(input: CreateEmployeeInput) {
    // Generar clientCode si no se proporciona
    const clientCode = input.personalData.clientCode || await this.generateUniqueClientCode()

    return this.employeeRepository.create({
      type: input.type,
      personalData: {
        ...input.personalData,
        clientCode,
      },
      routeIds: input.routeIds,
    })
  }

  async update(id: string, input: UpdateEmployeeInput) {
    const exists = await this.employeeRepository.exists(id)
    if (!exists) {
      throw new GraphQLError('Employee not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    return this.employeeRepository.update(id, input)
  }

  async promoteToLead(id: string) {
    const exists = await this.employeeRepository.exists(id)
    if (!exists) {
      throw new GraphQLError('Employee not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    return this.employeeRepository.promoteToLead(id)
  }

  private async generateUniqueClientCode(): Promise<string> {
    let code: string
    let exists: boolean

    do {
      code = generateClientCode()
      const personalData = await this.prisma.personalData.findUnique({
        where: { clientCode: code },
      })
      exists = !!personalData
    } while (exists)

    return code
  }
}
