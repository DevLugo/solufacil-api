import { GraphQLError } from 'graphql'
import type { PrismaClient } from '@solufacil/database'
import { PersonalDataRepository } from '../repositories/PersonalDataRepository'
import { generateClientCode } from '@solufacil/shared'

export interface SearchPersonalDataInput {
  searchTerm: string
  excludeBorrowerId?: string
  locationId?: string
  limit?: number
}

export interface CreatePersonalDataInput {
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

export interface UpdatePhoneInput {
  personalDataId: string
  phoneId?: string
  number: string
}

export class PersonalDataService {
  private personalDataRepository: PersonalDataRepository

  constructor(private prisma: PrismaClient) {
    this.personalDataRepository = new PersonalDataRepository(prisma)
  }

  async findById(id: string) {
    const personalData = await this.personalDataRepository.findById(id)
    if (!personalData) {
      throw new GraphQLError('PersonalData not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }
    return personalData
  }

  async search(input: SearchPersonalDataInput) {
    if (input.searchTerm.length < 2) {
      return []
    }

    return this.personalDataRepository.search({
      searchTerm: input.searchTerm,
      excludeBorrowerId: input.excludeBorrowerId,
      locationId: input.locationId,
      limit: input.limit || 10,
    })
  }

  async create(input: CreatePersonalDataInput) {
    const clientCode = input.clientCode || (await this.generateUniqueClientCode())

    return this.personalDataRepository.create({
      fullName: input.fullName,
      clientCode,
      birthDate: input.birthDate,
      phones: input.phones,
      addresses: input.addresses,
    })
  }

  async updatePhone(input: UpdatePhoneInput) {
    const exists = await this.personalDataRepository.exists(input.personalDataId)
    if (!exists) {
      throw new GraphQLError('PersonalData not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    return this.personalDataRepository.updatePhone(
      input.personalDataId,
      input.phoneId,
      input.number
    )
  }

  async updateName(id: string, fullName: string) {
    const exists = await this.personalDataRepository.exists(id)
    if (!exists) {
      throw new GraphQLError('PersonalData not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    return this.personalDataRepository.updateName(id, fullName)
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
