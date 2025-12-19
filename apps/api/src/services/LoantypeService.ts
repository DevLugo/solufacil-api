import { GraphQLError } from 'graphql'
import type { PrismaClient } from '@solufacil/database'
import { Decimal } from 'decimal.js'
import { LoantypeRepository } from '../repositories/LoantypeRepository'

export interface CreateLoantypeInput {
  name: string
  weekDuration: number
  rate: number | string
  loanPaymentComission: number | string
  loanGrantedComission: number | string
}

export interface UpdateLoantypeInput {
  name?: string
  weekDuration?: number
  rate?: number | string
  loanPaymentComission?: number | string
  loanGrantedComission?: number | string
}

export class LoantypeService {
  private loantypeRepository: LoantypeRepository

  constructor(prisma: PrismaClient) {
    this.loantypeRepository = new LoantypeRepository(prisma)
  }

  async findById(id: string) {
    const loantype = await this.loantypeRepository.findById(id)
    if (!loantype) {
      throw new GraphQLError('Loantype not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }
    return loantype
  }

  async findMany() {
    // Note: isActive filter not supported - field doesn't exist in schema
    return this.loantypeRepository.findMany()
  }

  async create(input: CreateLoantypeInput) {
    return this.loantypeRepository.create({
      name: input.name,
      weekDuration: input.weekDuration,
      rate: new Decimal(input.rate),
      loanPaymentComission: new Decimal(input.loanPaymentComission),
      loanGrantedComission: new Decimal(input.loanGrantedComission),
    })
  }

  async update(id: string, input: UpdateLoantypeInput) {
    const exists = await this.loantypeRepository.exists(id)
    if (!exists) {
      throw new GraphQLError('Loantype not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const updateData: Record<string, unknown> = {}

    if (input.name !== undefined) updateData.name = input.name
    if (input.weekDuration !== undefined) updateData.weekDuration = input.weekDuration
    if (input.rate !== undefined) updateData.rate = new Decimal(input.rate)
    if (input.loanPaymentComission !== undefined) updateData.loanPaymentComission = new Decimal(input.loanPaymentComission)
    if (input.loanGrantedComission !== undefined) updateData.loanGrantedComission = new Decimal(input.loanGrantedComission)

    return this.loantypeRepository.update(id, updateData)
  }
}
