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

  private getActiveLoans(borrower: any) {
    return borrower.loans.filter(
      (loan: any) => loan.status === 'ACTIVE' && !loan.renewedBy
    )
  }

  /**
   * Obtiene el préstamo activo más reciente (para renovaciones)
   * Ordena por signDate descendente y devuelve el primero
   */
  private getMostRecentActiveLoan(activeLoans: any[]): any | null {
    if (!activeLoans.length) return null

    return [...activeLoans].sort((a, b) =>
      new Date(b.signDate).getTime() - new Date(a.signDate).getTime()
    )[0]
  }

  private calculatePendingDebt(activeLoans: any[]) {
    return activeLoans.reduce(
      (sum, loan) => sum + parseFloat(loan.pendingAmountStored || '0'),
      0
    )
  }

  private getLastFinishedLoan(borrower: any) {
    const finishedLoans = borrower.loans.filter((loan: any) => loan.status === 'FINISHED')
    if (!finishedLoans.length) return null

    return [...finishedLoans].sort((a, b) =>
      new Date(b.signDate).getTime() - new Date(a.signDate).getTime()
    )[0]
  }

  /**
   * Construye el objeto activeLoan con todos los datos necesarios para renovaciones
   */
  private buildActiveLoanData(loan: any) {
    if (!loan) return undefined

    return {
      id: loan.id,
      requestedAmount: loan.requestedAmount.toString(),
      amountGived: loan.amountGived.toString(),
      pendingAmountStored: loan.pendingAmountStored.toString(),
      profitAmount: loan.profitAmount.toString(),
      totalDebtAcquired: loan.totalDebtAcquired.toString(),
      expectedWeeklyPayment: loan.expectedWeeklyPayment.toString(),
      totalPaid: loan.totalPaid.toString(),
      signDate: loan.signDate,
      loantype: loan.loantypeRelation ? {
        id: loan.loantypeRelation.id,
        name: loan.loantypeRelation.name,
        weekDuration: loan.loantypeRelation.weekDuration,
        rate: loan.loantypeRelation.rate,
        loanPaymentComission: loan.loantypeRelation.loanPaymentComission || '0',
        loanGrantedComission: loan.loantypeRelation.loanGrantedComission || '0',
      } : null,
      collaterals: (loan.collaterals || []).map((c: any) => ({
        id: c.id,
        fullName: c.fullName,
        phones: c.phones || [],
      })),
      leadLocationName: loan.leadRelation?.personalDataRelation?.addresses?.[0]?.locationRelation?.name || undefined,
    }
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

    return results.map((borrower) => {
      const activeLoans = this.getActiveLoans(borrower)
      const pendingDebtAmount = this.calculatePendingDebt(activeLoans)
      const lastFinishedLoan = this.getLastFinishedLoan(borrower)
      const mostRecentActiveLoan = this.getMostRecentActiveLoan(activeLoans)
      const activeLoan = this.buildActiveLoanData(mostRecentActiveLoan)

      return {
        id: borrower.id,
        personalData: borrower.personalDataRelation,
        loanFinishedCount: borrower.loanFinishedCount,
        hasActiveLoans: activeLoans.length > 0,
        pendingDebtAmount: pendingDebtAmount > 0 ? pendingDebtAmount.toString() : undefined,
        locationId: borrower.locationId,
        locationName: borrower.locationName,
        isFromCurrentLocation: borrower.isFromCurrentLocation ?? true,
        lastFinishedLoan: lastFinishedLoan ? {
          id: lastFinishedLoan.id,
          requestedAmount: lastFinishedLoan.requestedAmount.toString(),
          loantypeId: lastFinishedLoan.loantype,
          loantypeName: lastFinishedLoan.loantypeRelation?.name || '',
          weekDuration: lastFinishedLoan.loantypeRelation?.weekDuration || 0,
          rate: lastFinishedLoan.loantypeRelation?.rate?.toString() || '0',
          signDate: lastFinishedLoan.signDate,
          collaterals: ((lastFinishedLoan as any).collaterals || []).map((c: any) => ({
            id: c.id,
            fullName: c.fullName,
            phone: c.phones?.[0]?.number || null,
          })),
        } : undefined,
        activeLoan,
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
