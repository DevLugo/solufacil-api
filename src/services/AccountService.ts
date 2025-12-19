import { GraphQLError } from 'graphql'
import { Decimal } from 'decimal.js'
import type { PrismaClient, AccountType } from '@solufacil/database'
import { AccountRepository } from '../repositories/AccountRepository'

export interface CreateAccountInput {
  name: string
  type: AccountType
  amount: string | number
  routeIds?: string[]
}

export interface UpdateAccountInput {
  name?: string
  isActive?: boolean
}

export class AccountService {
  private accountRepository: AccountRepository

  constructor(prisma: PrismaClient) {
    this.accountRepository = new AccountRepository(prisma)
  }

  async findById(id: string) {
    const account = await this.accountRepository.findById(id)
    if (!account) {
      throw new GraphQLError('Account not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }
    return account
  }

  async findMany(options?: { routeId?: string; type?: AccountType }) {
    return this.accountRepository.findMany(options)
  }

  async create(input: CreateAccountInput) {
    return this.accountRepository.create({
      name: input.name,
      type: input.type,
      amount: new Decimal(input.amount),
      routeIds: input.routeIds,
    })
  }

  async update(id: string, input: UpdateAccountInput) {
    const exists = await this.accountRepository.exists(id)
    if (!exists) {
      throw new GraphQLError('Account not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    return this.accountRepository.update(id, input)
  }

  async getAccountBalance(id: string): Promise<Decimal> {
    return this.accountRepository.calculateBalance(id)
  }
}
