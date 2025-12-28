import { GraphQLError } from 'graphql'
import type { PrismaClient } from '@solufacil/database'
import { BorrowerRepository } from '../repositories/BorrowerRepository'
import { generateClientCode } from '@solufacil/shared'

export interface CreateBorrowerInput {
  personalData: {
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
}

export interface UpdateBorrowerInput {
  personalData?: {
    fullName?: string
    birthDate?: Date
  }
}

export interface SearchBorrowersInput {
  searchTerm: string
  leadId?: string
  locationId?: string
  limit?: number
}

export class BorrowerService {
  private borrowerRepository: BorrowerRepository

  constructor(private prisma: PrismaClient) {
    this.borrowerRepository = new BorrowerRepository(prisma)
  }

  async findById(id: string) {
    const borrower = await this.borrowerRepository.findById(id)
    if (!borrower) {
      throw new GraphQLError('Borrower not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }
    return borrower
  }

  async findMany(options?: { limit?: number; offset?: number }) {
    return this.borrowerRepository.findMany(options)
  }

  async create(input: CreateBorrowerInput) {
    // Generar clientCode si no se proporciona
    const clientCode = input.personalData.clientCode || await this.generateUniqueClientCode()

    return this.borrowerRepository.create({
      personalData: {
        ...input.personalData,
        clientCode,
      },
    })
  }

  async update(id: string, input: UpdateBorrowerInput) {
    const exists = await this.borrowerRepository.exists(id)
    if (!exists) {
      throw new GraphQLError('Borrower not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    return this.borrowerRepository.update(id, input)
  }

  async searchByName(input: SearchBorrowersInput) {
    if (input.searchTerm.length < 2) {
      return []
    }

    const results = await this.borrowerRepository.search({
      searchTerm: input.searchTerm,
      leadId: input.leadId,
      locationId: input.locationId,
      limit: input.limit || 10,
    })

    // Transformar resultados al formato BorrowerSearchResult
    return results.map((borrower) => {
      // Filtrar solo préstamos:
      // 1. ACTIVE (no RENOVATED, FINISHED, etc.)
      // 2. Sin renewedBy (no han sido renovados por otro préstamo)
      const activeLoans = borrower.loans.filter(
        (loan) => loan.status === 'ACTIVE' && !loan.renewedBy
      )

      const pendingDebtAmount = activeLoans.reduce(
        (sum, loan) => sum + parseFloat(loan.pendingAmountStored || '0'),
        0
      )

      return {
        id: borrower.id,
        personalData: borrower.personalDataRelation,
        loanFinishedCount: borrower.loanFinishedCount,
        hasActiveLoans: activeLoans.length > 0,
        pendingDebtAmount: pendingDebtAmount > 0 ? pendingDebtAmount.toString() : undefined,
        locationId: borrower.locationId,
        locationName: borrower.locationName,
        isFromCurrentLocation: borrower.isFromCurrentLocation ?? true,
      }
    })
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
