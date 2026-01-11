import { GraphQLError } from 'graphql'
import { Decimal } from 'decimal.js'
import type { PrismaClient, LoanStatus, PaymentMethod } from '@solufacil/database'
import { LoanRepository } from '../repositories/LoanRepository'
import { LoantypeRepository } from '../repositories/LoantypeRepository'
import { BorrowerRepository } from '../repositories/BorrowerRepository'
import { EmployeeRepository } from '../repositories/EmployeeRepository'
import { AccountRepository } from '../repositories/AccountRepository'
import { PaymentRepository } from '../repositories/PaymentRepository'
import { PersonalDataRepository } from '../repositories/PersonalDataRepository'
import { BalanceService } from './BalanceService'
import { calculateLoanMetrics, createLoanSnapshot, calculatePaymentProfit, calculateProfitHeredado, LoanEngine } from '@solufacil/business-logic'
import { generateClientCode } from '@solufacil/shared'
import { getWeekStartDate, getWeekEndDate } from '../utils/weekUtils'

export interface CreateLoanInput {
  requestedAmount: string | number
  amountGived: string | number
  signDate: Date
  borrowerId: string
  loantypeId: string
  grantorId: string
  leadId: string
  collateralIds?: string[]
  previousLoanId?: string
}

export interface UpdateLoanInput {
  amountGived?: string | number
  badDebtDate?: Date | null
  isDeceased?: boolean
  leadId?: string
  status?: LoanStatus
}

export interface RenewLoanInput {
  requestedAmount: string | number
  amountGived: string | number
  signDate: Date
  loantypeId: string
}

export interface FirstPaymentInput {
  amount: string | number
  comission?: string | number
  paymentMethod: PaymentMethod
}

export interface CreateSingleLoanInput {
  tempId: string
  requestedAmount: string | number
  amountGived: string | number
  loantypeId: string
  comissionAmount?: string | number
  previousLoanId?: string
  borrowerId?: string
  newBorrower?: {
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
  collateralIds?: string[]
  newCollateral?: {
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
  firstPayment?: FirstPaymentInput
  isFromDifferentLocation?: boolean
}

export interface CreateLoansInBatchInput {
  loans: CreateSingleLoanInput[]
  sourceAccountId: string
  signDate: Date
  leadId: string
  grantorId: string
}

export interface UpdateLoanExtendedInput {
  loantypeId?: string
  requestedAmount?: string
  borrowerName?: string
  borrowerPhone?: string
  comissionAmount?: string
  collateralIds?: string[]
  newCollateral?: {
    fullName: string
    clientCode?: string
    phones?: { number: string }[]
    addresses?: {
      street: string
      numberInterior?: string
      numberExterior?: string
      zipCode?: string
      locationId: string
    }[]
  }
  collateralPhone?: string
}

export class LoanService {
  private loanRepository: LoanRepository
  private loantypeRepository: LoantypeRepository
  private borrowerRepository: BorrowerRepository
  private employeeRepository: EmployeeRepository
  private accountRepository: AccountRepository
  private paymentRepository: PaymentRepository
  private personalDataRepository: PersonalDataRepository
  private balanceService: BalanceService

  constructor(private prisma: PrismaClient) {
    this.loanRepository = new LoanRepository(prisma)
    this.loantypeRepository = new LoantypeRepository(prisma)
    this.borrowerRepository = new BorrowerRepository(prisma)
    this.employeeRepository = new EmployeeRepository(prisma)
    this.accountRepository = new AccountRepository(prisma)
    this.paymentRepository = new PaymentRepository(prisma)
    this.personalDataRepository = new PersonalDataRepository(prisma)
    this.balanceService = new BalanceService(prisma)
  }

  async findById(id: string) {
    const loan = await this.loanRepository.findById(id)
    if (!loan) {
      throw new GraphQLError('Loan not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }
    return loan
  }

  async findMany(options?: {
    status?: LoanStatus
    statuses?: LoanStatus[]
    routeId?: string
    leadId?: string
    locationId?: string
    borrowerId?: string
    fromDate?: Date
    toDate?: Date
    excludePortfolioCleanup?: boolean
    limit?: number
    offset?: number
  }) {
    return this.loanRepository.findMany(options)
  }

  async findByWeekAndLocation(options: {
    year: number
    weekNumber: number
    routeId?: string
    locationId?: string
    limit?: number
    offset?: number
  }) {
    const weekStart = getWeekStartDate(options.year, options.weekNumber)
    const weekEnd = getWeekEndDate(options.year, options.weekNumber)

    const { loans } = await this.loanRepository.findMany({
      routeId: options.routeId,
      locationId: options.locationId,
      fromDate: weekStart,
      toDate: weekEnd,
      status: 'ACTIVE',
      limit: options.limit,
      offset: options.offset
    })

    return loans
  }

  /**
   * Procesa la renovación de un préstamo:
   * - Calcula profit heredado
   * - Marca préstamo anterior como FINISHED
   * - Incrementa loanFinishedCount del borrower
   *
   * @returns El profit heredado a sumar al nuevo préstamo
   */
  private async processLoanRenewal(
    previousLoanId: string,
    signDate: Date,
    tx?: any
  ): Promise<Decimal> {
    const client = tx || this.prisma

    const previousLoan = await client.loan.findUnique({
      where: { id: previousLoanId },
      select: {
        id: true,
        borrower: true,
        pendingAmountStored: true,
        profitAmount: true,
        totalDebtAcquired: true,
        renewedBy: true,
      },
    })

    if (!previousLoan) {
      throw new GraphQLError('Previous loan not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    if (previousLoan.renewedBy) {
      throw new GraphQLError(
        'Este préstamo ya fue renovado. Por favor, recarga la página para ver los préstamos disponibles actualizados.',
        { extensions: { code: 'BAD_USER_INPUT' } }
      )
    }

    const { profitHeredado } = calculateProfitHeredado(
      new Decimal(previousLoan.pendingAmountStored.toString()),
      new Decimal(previousLoan.profitAmount.toString()),
      new Decimal(previousLoan.totalDebtAcquired.toString())
    )

    await client.loan.update({
      where: { id: previousLoanId },
      data: {
        status: 'FINISHED',
        renewedDate: signDate,
        finishedDate: signDate,
      },
    })

    await client.borrower.update({
      where: { id: previousLoan.borrower },
      data: { loanFinishedCount: { increment: 1 } }
    })

    return profitHeredado
  }

  async create(input: CreateLoanInput) {
    // Validar que el loantype existe
    const loantype = await this.loantypeRepository.findById(input.loantypeId)
    if (!loantype) {
      throw new GraphQLError('Loantype not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Validar que el borrower existe
    const borrowerExists = await this.borrowerRepository.exists(input.borrowerId)
    if (!borrowerExists) {
      throw new GraphQLError('Borrower not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Obtener datos del lead para el snapshot
    const lead = await this.employeeRepository.findById(input.leadId)
    if (!lead) {
      throw new GraphQLError('Lead not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Calcular métricas del préstamo
    const requestedAmount = new Decimal(input.requestedAmount)
    const amountGived = new Decimal(input.amountGived)
    const rate = new Decimal(loantype.rate.toString())

    const metrics = calculateLoanMetrics(
      requestedAmount,
      rate,
      loantype.weekDuration
    )

    // Manejar profit pendiente si es renovación
    const pendingProfit = input.previousLoanId
      ? await this.processLoanRenewal(input.previousLoanId, input.signDate)
      : new Decimal(0)

    // Crear snapshot histórico (solo del lead, la ruta se determina vía LocationHistoryService)
    const snapshot = createLoanSnapshot(lead.id)

    // Calcular métricas finales
    // REGLA CRÍTICA: profitHeredado solo se suma a profitAmount para distribución de pagos
    // La deuda total (totalDebtAcquired) NO incluye profitHeredado
    // Deuda siempre es: requestedAmount + profitBase
    const finalProfitAmount = metrics.profitAmount.plus(pendingProfit)

    // Crear el préstamo
    return this.loanRepository.create({
      requestedAmount: requestedAmount,
      amountGived: amountGived,
      signDate: input.signDate,
      profitAmount: finalProfitAmount,
      totalDebtAcquired: metrics.totalDebtAcquired,
      expectedWeeklyPayment: metrics.expectedWeeklyPayment,
      pendingAmountStored: metrics.totalDebtAcquired,
      borrower: input.borrowerId,
      loantype: input.loantypeId,
      grantor: input.grantorId,
      lead: input.leadId,
      collateralIds: input.collateralIds,
      previousLoan: input.previousLoanId,
      ...snapshot,
    })
  }

  async update(id: string, input: UpdateLoanInput) {
    const exists = await this.loanRepository.exists(id)
    if (!exists) {
      throw new GraphQLError('Loan not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const updateData: Parameters<typeof this.loanRepository.update>[1] = {}

    if (input.amountGived !== undefined) {
      updateData.amountGived = new Decimal(input.amountGived)
    }
    if (input.badDebtDate !== undefined) {
      updateData.badDebtDate = input.badDebtDate
    }
    if (input.isDeceased !== undefined) {
      updateData.isDeceased = input.isDeceased
    }
    if (input.leadId !== undefined) {
      updateData.lead = input.leadId
    }
    if (input.status !== undefined) {
      updateData.status = input.status
    }

    return this.loanRepository.update(id, updateData)
  }

  async renewLoan(loanId: string, input: RenewLoanInput) {
    // Obtener el préstamo a renovar
    const existingLoan = await this.loanRepository.findById(loanId)
    if (!existingLoan) {
      throw new GraphQLError('Loan not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Validar que el préstamo esté activo
    if (existingLoan.status !== 'ACTIVE') {
      throw new GraphQLError('Only active loans can be renewed', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    // Crear nuevo préstamo con referencia al anterior
    return this.create({
      requestedAmount: input.requestedAmount,
      amountGived: input.amountGived,
      signDate: input.signDate,
      borrowerId: existingLoan.borrower,
      loantypeId: input.loantypeId,
      grantorId: existingLoan.grantor || '',
      leadId: existingLoan.lead || '',
      previousLoanId: loanId,
    })
  }

  async markAsBadDebt(loanId: string, badDebtDate: Date) {
    const exists = await this.loanRepository.exists(loanId)
    if (!exists) {
      throw new GraphQLError('Loan not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    return this.loanRepository.update(loanId, { badDebtDate })
  }

  async finishLoan(loanId: string) {
    const loan = await this.loanRepository.findById(loanId)
    if (!loan) {
      throw new GraphQLError('Loan not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Actualizar contador de préstamos terminados del borrower
    await this.borrowerRepository.incrementLoanFinishedCount(loan.borrower)

    return this.loanRepository.update(loanId, {
      status: 'FINISHED',
      finishedDate: new Date(),
    })
  }

  async cancelLoan(loanId: string) {
    const exists = await this.loanRepository.exists(loanId)
    if (!exists) {
      throw new GraphQLError('Loan not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    return this.loanRepository.update(loanId, {
      status: 'CANCELLED',
    })
  }

  async findForBadDebt(routeId?: string) {
    return this.loanRepository.findForBadDebt(routeId)
  }

  async createLoansInBatch(input: CreateLoansInBatchInput) {
    // Validar que hay préstamos para crear
    if (input.loans.length === 0) {
      throw new GraphQLError('No loans to create', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    // Calcular el total a deducir de la cuenta (amountGived + comisión de cada préstamo)
    let totalAmountToDeduct = new Decimal(0)
    for (const loanInput of input.loans) {
      const amountGived = new Decimal(loanInput.amountGived)
      const comission = loanInput.comissionAmount ? new Decimal(loanInput.comissionAmount) : new Decimal(0)
      totalAmountToDeduct = totalAmountToDeduct.plus(amountGived).plus(comission)
    }

    // Verificar que la cuenta existe y tiene fondos suficientes
    const sourceAccount = await this.accountRepository.findById(input.sourceAccountId)
    if (!sourceAccount) {
      throw new GraphQLError('Source account not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const accountBalance = new Decimal(sourceAccount.amount.toString())
    if (accountBalance.lessThan(totalAmountToDeduct)) {
      throw new GraphQLError('Insufficient funds in source account', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    // Obtener datos del lead para snapshots
    const lead = await this.employeeRepository.findById(input.leadId)
    if (!lead) {
      throw new GraphQLError('Lead not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Crear snapshot histórico (solo del lead, la ruta se determina vía LocationHistoryService)
    const snapshot = createLoanSnapshot(lead.id)

    // Obtener routeId de la cuenta fuente
    const routeId = sourceAccount.routes[0]?.id || ''

    // Ejecutar todo en una transacción
    return this.prisma.$transaction(async (tx) => {
      const balanceService = new BalanceService(tx as any)
      const createdLoans: any[] = []

      // Track first payments for LeadPaymentReceived
      const firstPaymentsCreated: {
        paymentId: string
        amount: Decimal
        commission: Decimal
        paymentMethod: 'CASH' | 'MONEY_TRANSFER'
      }[] = []

      for (const loanInput of input.loans) {
        // 1. Obtener o crear el borrower
        let borrowerId = loanInput.borrowerId
        if (!borrowerId && loanInput.newBorrower) {
          const clientCode = loanInput.newBorrower.personalData.clientCode || await this.generateUniqueClientCode(tx)
          const newBorrower = await tx.borrower.create({
            data: {
              personalDataRelation: {
                create: {
                  fullName: loanInput.newBorrower.personalData.fullName,
                  clientCode,
                  birthDate: loanInput.newBorrower.personalData.birthDate,
                  phones: loanInput.newBorrower.personalData.phones
                    ? { create: loanInput.newBorrower.personalData.phones }
                    : undefined,
                  addresses: loanInput.newBorrower.personalData.addresses
                    ? {
                        create: loanInput.newBorrower.personalData.addresses.map((addr) => ({
                          street: addr.street,
                          interiorNumber: addr.numberInterior || '',
                          exteriorNumber: addr.numberExterior || '',
                          postalCode: addr.zipCode || '',
                          location: addr.locationId,
                        })),
                      }
                    : undefined,
                },
              },
            },
          })
          borrowerId = newBorrower.id
        }

        if (!borrowerId) {
          throw new GraphQLError(`Loan ${loanInput.tempId}: borrowerId or newBorrower is required`, {
            extensions: { code: 'BAD_USER_INPUT' },
          })
        }

        // 2. Obtener o crear collaterals (aval)
        let collateralIds = loanInput.collateralIds || []
        if (loanInput.newCollateral) {
          const collateralCode = loanInput.newCollateral.clientCode || await this.generateUniqueClientCode(tx)
          const newCollateral = await tx.personalData.create({
            data: {
              fullName: loanInput.newCollateral.fullName,
              clientCode: collateralCode,
              birthDate: loanInput.newCollateral.birthDate,
              phones: loanInput.newCollateral.phones
                ? { create: loanInput.newCollateral.phones }
                : undefined,
              addresses: loanInput.newCollateral.addresses
                ? {
                    create: loanInput.newCollateral.addresses.map((addr) => ({
                      street: addr.street,
                      interiorNumber: addr.numberInterior || '',
                      exteriorNumber: addr.numberExterior || '',
                      postalCode: addr.zipCode || '',
                      location: addr.locationId,
                    })),
                  }
                : undefined,
            },
          })
          collateralIds = [...collateralIds, newCollateral.id]
        }

        // 3. Obtener el loantype
        const loantype = await this.loantypeRepository.findById(loanInput.loantypeId)
        if (!loantype) {
          throw new GraphQLError(`Loan ${loanInput.tempId}: Loantype not found`, {
            extensions: { code: 'NOT_FOUND' },
          })
        }

        // 4. Calcular métricas del préstamo
        const requestedAmount = new Decimal(loanInput.requestedAmount)
        const amountGived = new Decimal(loanInput.amountGived)
        const rate = new Decimal(loantype.rate.toString())
        const metrics = calculateLoanMetrics(requestedAmount, rate, loantype.weekDuration)

        // 5. Manejar profit pendiente si es renovación
        const pendingProfit = loanInput.previousLoanId
          ? await this.processLoanRenewal(loanInput.previousLoanId, input.signDate, tx)
          : new Decimal(0)

        // 6. Crear el préstamo
        // Note: La deuda anterior ya está descontada en amountGived
        // REGLA CRÍTICA: profitHeredado solo se suma a profitAmount para distribución de pagos
        // La deuda total (totalDebtAcquired) NO incluye profitHeredado
        // Deuda siempre es: requestedAmount + profitBase
        const comissionAmount = loanInput.comissionAmount
          ? new Decimal(loanInput.comissionAmount)
          : new Decimal(0)

        // Calcular profit final (incluye heredado para distribución de pagos)
        const finalProfitAmount = metrics.profitAmount.plus(pendingProfit)

        const loan = await tx.loan.create({
          data: {
            requestedAmount,
            amountGived,
            signDate: input.signDate,
            profitAmount: finalProfitAmount,
            totalDebtAcquired: metrics.totalDebtAcquired,
            expectedWeeklyPayment: metrics.expectedWeeklyPayment,
            pendingAmountStored: metrics.totalDebtAcquired,
            totalPaid: new Decimal(0),
            comissionAmount,
            borrower: borrowerId,
            loantype: loanInput.loantypeId,
            grantor: input.grantorId,
            lead: input.leadId,
            previousLoan: loanInput.previousLoanId,
            ...snapshot,
            collaterals: collateralIds.length > 0
              ? { connect: collateralIds.map((id) => ({ id })) }
              : undefined,
          },
          include: {
            borrowerRelation: {
              include: {
                personalDataRelation: {
                  include: {
                    phones: true,
                  },
                },
              },
            },
            loantypeRelation: true,
            collaterals: {
              include: {
                phones: true,
              },
            },
          },
        })

        // 7. DEBIT: Monto otorgado del préstamo
        await balanceService.createEntry({
          accountId: input.sourceAccountId,
          entryType: 'DEBIT',
          amount: amountGived,
          sourceType: 'LOAN_GRANT',
          entryDate: input.signDate,
          loanId: loan.id,
          snapshotLeadId: input.leadId,
          snapshotRouteId: routeId,
        }, tx)

        // 7.1. DEBIT: Comisión de otorgamiento
        if (comissionAmount.greaterThan(0)) {
          await balanceService.createEntry({
            accountId: input.sourceAccountId,
            entryType: 'DEBIT',
            amount: comissionAmount,
            sourceType: 'LOAN_GRANT_COMMISSION',
            entryDate: input.signDate,
            loanId: loan.id,
            snapshotLeadId: input.leadId,
            snapshotRouteId: routeId,
          }, tx)
        }

        // 8. Crear primer pago si se especificó
        if (loanInput.firstPayment) {
          const paymentAmount = new Decimal(loanInput.firstPayment.amount)
          // Use commission from input, otherwise default to loantype's loanPaymentComission
          const firstPaymentComission = loanInput.firstPayment.comission !== undefined
            ? new Decimal(loanInput.firstPayment.comission)
            : loantype.loanPaymentComission
              ? new Decimal(loantype.loanPaymentComission.toString())
              : new Decimal(0)

          // Calcular profit del pago
          const { profitAmount, returnToCapital } = calculatePaymentProfit(
            paymentAmount,
            metrics.profitAmount,
            metrics.totalDebtAcquired,
            false
          )

          // Crear el pago (sin leadPaymentReceivedId todavía)
          const payment = await tx.loanPayment.create({
            data: {
              amount: paymentAmount,
              comission: firstPaymentComission,
              receivedAt: input.signDate,
              paymentMethod: loanInput.firstPayment.paymentMethod,
              type: 'PAYMENT',
              loan: loan.id,
            },
          })

          // Track this payment for LeadPaymentReceived
          firstPaymentsCreated.push({
            paymentId: payment.id,
            amount: paymentAmount,
            commission: firstPaymentComission,
            paymentMethod: loanInput.firstPayment.paymentMethod,
          })

          // CREDIT: Primer pago recibido
          await balanceService.createEntry({
            accountId: input.sourceAccountId,
            entryType: 'CREDIT',
            amount: paymentAmount,
            sourceType: loanInput.firstPayment.paymentMethod === 'CASH' ? 'LOAN_PAYMENT_CASH' : 'LOAN_PAYMENT_BANK',
            entryDate: input.signDate,
            loanId: loan.id,
            loanPaymentId: payment.id,
            profitAmount,
            returnToCapital,
            snapshotLeadId: input.leadId,
            snapshotRouteId: routeId,
          }, tx)

          // DEBIT: Comisión del primer pago
          if (firstPaymentComission.greaterThan(0)) {
            await balanceService.createEntry({
              accountId: input.sourceAccountId,
              entryType: 'DEBIT',
              amount: firstPaymentComission,
              sourceType: 'PAYMENT_COMMISSION',
              entryDate: input.signDate,
              loanPaymentId: payment.id,
              snapshotLeadId: input.leadId,
              snapshotRouteId: routeId,
            }, tx)
          }

          // Actualizar métricas del préstamo
          // NOTA: NO sumamos firstPaymentComission a comissionAmount porque ya está en el registro del pago (loanPayment.comission)
          // Si lo sumáramos aquí, se contaría dos veces al cancelar el préstamo (una vez en loan.comissionAmount y otra en payment.comission)
          const updatedPending = metrics.totalDebtAcquired.minus(paymentAmount)
          await tx.loan.update({
            where: { id: loan.id },
            data: {
              totalPaid: paymentAmount,
              pendingAmountStored: updatedPending.isNegative() ? new Decimal(0) : updatedPending,
              // comissionAmount solo incluye la comisión de otorgamiento, no la del primer pago
              // La comisión del primer pago está en loanPayment.comission
              ...(updatedPending.lessThanOrEqualTo(0) && {
                status: 'FINISHED',
                finishedDate: input.signDate,
              }),
            },
          })
        }

        createdLoans.push(loan)
      }

      // 9. Crear o actualizar LeadPaymentReceived si hubo primeros pagos
      if (firstPaymentsCreated.length > 0) {
        // Calculate totals
        let totalCashPaid = new Decimal(0)
        let totalBankPaid = new Decimal(0)
        let totalAmount = new Decimal(0)

        for (const fp of firstPaymentsCreated) {
          totalAmount = totalAmount.plus(fp.amount)
          if (fp.paymentMethod === 'CASH') {
            totalCashPaid = totalCashPaid.plus(fp.amount)
          } else {
            totalBankPaid = totalBankPaid.plus(fp.amount)
          }
        }

        // Search for existing LPR from the same day (signDate) and lead to reuse
        // Important: Use signDate, not current date, to correctly associate with the payment day
        const signDateStart = new Date(input.signDate)
        signDateStart.setHours(0, 0, 0, 0)
        const signDateEnd = new Date(signDateStart)
        signDateEnd.setDate(signDateEnd.getDate() + 1)

        const existingLPR = await tx.leadPaymentReceived.findFirst({
          where: {
            lead: input.leadId,
            createdAt: {
              gte: signDateStart,
              lt: signDateEnd,
            },
          },
        })

        let leadPaymentReceivedId: string

        if (existingLPR) {
          // Update existing LPR by ADDING the new amounts
          console.log('[LoanService] Updating existing LeadPaymentReceived:', {
            existingId: existingLPR.id,
            existingPaidAmount: existingLPR.paidAmount.toString(),
            existingCashPaidAmount: existingLPR.cashPaidAmount.toString(),
            existingBankPaidAmount: existingLPR.bankPaidAmount?.toString() || '0',
            addingAmount: totalAmount.toString(),
            addingCashPaid: totalCashPaid.toString(),
            addingBankPaid: totalBankPaid.toString(),
          })

          await tx.leadPaymentReceived.update({
            where: { id: existingLPR.id },
            data: {
              expectedAmount: { increment: totalAmount },
              paidAmount: { increment: totalAmount },
              cashPaidAmount: { increment: totalCashPaid },
              bankPaidAmount: { increment: totalBankPaid },
            },
          })
          leadPaymentReceivedId = existingLPR.id
        } else {
          // Create new LPR if none exists for the sign date
          console.log('[LoanService] Creating new LeadPaymentReceived for first payments:', {
            signDate: input.signDate,
            totalAmount: totalAmount.toString(),
            totalCashPaid: totalCashPaid.toString(),
            totalBankPaid: totalBankPaid.toString(),
            paymentsCount: firstPaymentsCreated.length,
          })

          const newLPR = await tx.leadPaymentReceived.create({
            data: {
              expectedAmount: totalAmount,
              paidAmount: totalAmount,
              cashPaidAmount: totalCashPaid,
              bankPaidAmount: totalBankPaid,
              paymentStatus: 'COMPLETE',
              lead: input.leadId,
              agent: input.leadId,
              // Use signDate, not current date, for correct day association
              createdAt: input.signDate,
            },
          })
          leadPaymentReceivedId = newLPR.id
        }

        // Link all first payments to the LeadPaymentReceived
        for (const fp of firstPaymentsCreated) {
          await tx.loanPayment.update({
            where: { id: fp.paymentId },
            data: { leadPaymentReceived: leadPaymentReceivedId },
          })
        }

        // Update AccountEntry to link to LeadPaymentReceived
        await tx.accountEntry.updateMany({
          where: {
            loanPaymentId: { in: firstPaymentsCreated.map((fp) => fp.paymentId) },
          },
          data: { leadPaymentReceivedId: leadPaymentReceivedId },
        })
      }

      // 10. Balance ya actualizado por BalanceService.createEntry
      // (Cada entrada DEBIT/CREDIT actualiza automáticamente Account.amount)

      return createdLoans
    })
  }

  async updateLoanExtended(loanId: string, input: UpdateLoanExtendedInput) {
    const loan = await this.loanRepository.findById(loanId)
    if (!loan) {
      throw new GraphQLError('Loan not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Actualizar tipo de préstamo si se especificó
      if (input.loantypeId && input.loantypeId !== loan.loantype) {
        const newLoantype = await this.loantypeRepository.findById(input.loantypeId)
        if (!newLoantype) {
          throw new GraphQLError('Loantype not found', {
            extensions: { code: 'NOT_FOUND' },
          })
        }

        // Recalcular métricas con el nuevo tipo
        const requestedAmount = new Decimal(loan.requestedAmount.toString())
        const rate = new Decimal(newLoantype.rate.toString())
        const metrics = calculateLoanMetrics(requestedAmount, rate, newLoantype.weekDuration)

        // Calcular el diferencial de deuda
        const oldTotalDebt = new Decimal(loan.totalDebtAcquired.toString())
        const newTotalDebt = metrics.totalDebtAcquired
        const debtDiff = newTotalDebt.minus(oldTotalDebt)

        const currentPending = new Decimal(loan.pendingAmountStored.toString())
        const newPending = currentPending.plus(debtDiff)

        await tx.loan.update({
          where: { id: loanId },
          data: {
            loantype: input.loantypeId,
            profitAmount: metrics.profitAmount,
            totalDebtAcquired: newTotalDebt,
            expectedWeeklyPayment: metrics.expectedWeeklyPayment,
            pendingAmountStored: newPending.isNegative() ? new Decimal(0) : newPending,
          },
        })
      }

      // 2. Actualizar monto solicitado y recalcular métricas si se especificó
      if (input.requestedAmount && input.requestedAmount !== loan.requestedAmount.toString()) {
        const newRequestedAmount = new Decimal(input.requestedAmount)

        // Obtener el loantype actual
        const currentLoantype = await this.loantypeRepository.findById(loan.loantype)
        if (!currentLoantype) {
          throw new GraphQLError('Loantype not found', {
            extensions: { code: 'NOT_FOUND' },
          })
        }

        // Recalcular métricas con el nuevo monto solicitado
        const rate = new Decimal(currentLoantype.rate.toString())
        const metrics = calculateLoanMetrics(newRequestedAmount, rate, currentLoantype.weekDuration)

        // Calcular el diferencial de deuda
        const oldTotalDebt = new Decimal(loan.totalDebtAcquired.toString())
        const newTotalDebt = metrics.totalDebtAcquired
        const debtDiff = newTotalDebt.minus(oldTotalDebt)

        const currentPending = new Decimal(loan.pendingAmountStored.toString())
        const newPending = currentPending.plus(debtDiff)

        await tx.loan.update({
          where: { id: loanId },
          data: {
            requestedAmount: newRequestedAmount,
            profitAmount: metrics.profitAmount,
            totalDebtAcquired: newTotalDebt,
            expectedWeeklyPayment: metrics.expectedWeeklyPayment,
            pendingAmountStored: newPending.isNegative() ? new Decimal(0) : newPending,
          },
        })
      }

      // 3. Manejar collaterals
      if (input.collateralIds || input.newCollateral) {
        let collateralIds = input.collateralIds || []

        // Crear nuevo collateral si se especificó
        if (input.newCollateral) {
          const clientCode = input.newCollateral.clientCode || await this.generateUniqueClientCode(tx)
          const newCollateral = await tx.personalData.create({
            data: {
              fullName: input.newCollateral.fullName,
              clientCode,
              phones: input.newCollateral.phones
                ? { create: input.newCollateral.phones }
                : undefined,
              addresses: input.newCollateral.addresses
                ? {
                    create: input.newCollateral.addresses.map((addr) => ({
                      street: addr.street,
                      interiorNumber: addr.numberInterior || '',
                      exteriorNumber: addr.numberExterior || '',
                      postalCode: addr.zipCode || '',
                      location: addr.locationId,
                    })),
                  }
                : undefined,
            },
          })
          collateralIds = [...collateralIds, newCollateral.id]
        }

        // Actualizar collaterals del préstamo
        await tx.loan.update({
          where: { id: loanId },
          data: {
            collaterals: {
              set: collateralIds.map((id) => ({ id })),
            },
          },
        })
      }

      // 4. Actualizar nombre del borrower si se especificó
      if (input.borrowerName) {
        const borrower = await tx.borrower.findUnique({
          where: { id: loan.borrower },
          include: {
            personalDataRelation: true,
          },
        })

        if (borrower?.personalDataRelation) {
          await tx.personalData.update({
            where: { id: borrower.personalDataRelation.id },
            data: { fullName: input.borrowerName },
          })
        }
      }

      // 5. Actualizar teléfono del borrower si se especificó
      if (input.borrowerPhone) {
        const borrower = await tx.borrower.findUnique({
          where: { id: loan.borrower },
          include: {
            personalDataRelation: {
              include: { phones: true },
            },
          },
        })

        if (borrower?.personalDataRelation) {
          const existingPhone = borrower.personalDataRelation.phones[0]
          if (existingPhone) {
            await tx.phone.update({
              where: { id: existingPhone.id },
              data: { number: input.borrowerPhone },
            })
          } else {
            await tx.phone.create({
              data: {
                number: input.borrowerPhone,
                personalData: borrower.personalDataRelation.id,
              },
            })
          }
        }
      }

      // 6. Actualizar comisión si se especificó
      if (input.comissionAmount !== undefined) {
        await tx.loan.update({
          where: { id: loanId },
          data: {
            comissionAmount: new Decimal(input.comissionAmount),
          },
        })
      }

      // 7. Actualizar teléfono del collateral si se especificó
      if (input.collateralPhone && loan.collaterals?.length > 0) {
        const collateral = loan.collaterals[0]
        const collateralData = await tx.personalData.findUnique({
          where: { id: collateral.id },
          include: { phones: true },
        })

        if (collateralData) {
          const existingPhone = collateralData.phones[0]
          if (existingPhone) {
            await tx.phone.update({
              where: { id: existingPhone.id },
              data: { number: input.collateralPhone },
            })
          } else {
            await tx.phone.create({
              data: {
                number: input.collateralPhone,
                personalData: collateralData.id,
              },
            })
          }
        }
      }

      // Retornar el préstamo actualizado
      return tx.loan.findUnique({
        where: { id: loanId },
        include: {
          borrowerRelation: {
            include: {
              personalDataRelation: {
                include: {
                  phones: true,
                  addresses: { include: { locationRelation: true } },
                },
              },
            },
          },
          loantypeRelation: true,
          collaterals: {
            include: {
              phones: true,
              addresses: { include: { locationRelation: true } },
            },
          },
        },
      })
    })
  }

  async cancelLoanWithAccountRestore(loanId: string, accountId: string) {
    const loan = await this.loanRepository.findById(loanId)
    if (!loan) {
      throw new GraphQLError('Loan not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const account = await this.accountRepository.findById(accountId)
    if (!account) {
      throw new GraphQLError('Account not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    return this.prisma.$transaction(async (tx) => {
      const balanceService = new BalanceService(tx as any)

      // 1. Obtener pagos del préstamo
      const payments = await tx.loanPayment.findMany({
        where: { loan: loanId },
      })

      // 2. Calcular totales por tipo de pago (para info de retorno)
      let totalCashPayments = new Decimal(0)
      let totalBankPayments = new Decimal(0)
      let totalPaymentComissions = new Decimal(0)

      for (const payment of payments) {
        const paymentAmount = new Decimal(payment.amount.toString())
        const paymentComission = new Decimal(payment.comission?.toString() || '0')

        if (payment.paymentMethod === 'MONEY_TRANSFER') {
          totalBankPayments = totalBankPayments.plus(paymentAmount)
        } else {
          totalCashPayments = totalCashPayments.plus(paymentAmount)
        }
        totalPaymentComissions = totalPaymentComissions.plus(paymentComission)
      }

      // 3. Para cada pago, eliminar entries y actualizar LeadPaymentReceived
      for (const payment of payments) {
        // 3.1 Eliminar AccountEntry asociados al pago (revierte balance automáticamente)
        await balanceService.deleteEntriesByLoanPayment(payment.id, tx)

        // 3.2 Si el pago está asociado a un LeadPaymentReceived, actualizarlo
        if (payment.leadPaymentReceived) {
          const lpr = await tx.leadPaymentReceived.findUnique({
            where: { id: payment.leadPaymentReceived },
          })

          if (lpr) {
            const paymentAmount = new Decimal(payment.amount.toString())
            const existingPaidAmount = new Decimal(lpr.paidAmount?.toString() || '0')
            const existingExpected = new Decimal(lpr.expectedAmount?.toString() || '0')
            const existingCashPaid = new Decimal(lpr.cashPaidAmount?.toString() || '0')
            const existingBankPaid = new Decimal(lpr.bankPaidAmount?.toString() || '0')

            const newPaidAmount = existingPaidAmount.minus(paymentAmount)
            const newExpected = existingExpected.minus(paymentAmount)

            if (payment.paymentMethod === 'CASH') {
              await tx.leadPaymentReceived.update({
                where: { id: lpr.id },
                data: {
                  paidAmount: newPaidAmount,
                  expectedAmount: newExpected,
                  cashPaidAmount: existingCashPaid.minus(paymentAmount),
                },
              })
            } else {
              await tx.leadPaymentReceived.update({
                where: { id: lpr.id },
                data: {
                  paidAmount: newPaidAmount,
                  expectedAmount: newExpected,
                  bankPaidAmount: existingBankPaid.minus(paymentAmount),
                },
              })
            }

            // Check if LPR has no more payments after this deletion
            const remainingPaymentsCount = await tx.loanPayment.count({
              where: {
                leadPaymentReceived: lpr.id,
                id: { not: payment.id },
              },
            })

            if (remainingPaymentsCount === 0) {
              // Delete entries associated with this LPR (transfers, falco, etc)
              await balanceService.deleteEntriesByLeadPaymentReceived(lpr.id, tx)
              await tx.leadPaymentReceived.delete({
                where: { id: lpr.id },
              })
            }
          }
        }

        // 3.3 Eliminar el pago
        await tx.loanPayment.delete({
          where: { id: payment.id },
        })
      }

      // 4. Eliminar entries del préstamo (LOAN_GRANT, LOAN_GRANT_COMMISSION)
      // Esto revierte automáticamente el balance
      await balanceService.deleteEntriesByLoan(loanId, tx)

      // 5. Si es renovación, reactivar el préstamo anterior
      if (loan.previousLoan) {
        const previousLoan = await tx.loan.findUnique({
          where: { id: loan.previousLoan },
          select: { borrower: true, pendingAmountStored: true }
        })

        // Solo decrementar loanFinishedCount si el préstamo anterior tenía deuda pendiente
        // (es decir, se "terminó" por renovación, no porque se pagó completamente)
        if (previousLoan && parseFloat(previousLoan.pendingAmountStored.toString()) > 0) {
          await tx.borrower.update({
            where: { id: previousLoan.borrower },
            data: { loanFinishedCount: { decrement: 1 } }
          })
        }

        await tx.loan.update({
          where: { id: loan.previousLoan },
          data: {
            status: 'ACTIVE',
            renewedDate: null,
            finishedDate: null,
          },
        })
      }

      // 6. Eliminar el préstamo
      await tx.loan.update({
        where: { id: loanId },
        data: { collaterals: { set: [] } },
      })

      await tx.loan.delete({
        where: { id: loanId },
      })

      // Calcular monto restaurado para info de retorno
      const amountGived = new Decimal(loan.amountGived.toString())
      const loanGrantedComission = new Decimal(loan.comissionAmount?.toString() || '0')
      const totalRestored = amountGived.plus(loanGrantedComission).minus(totalCashPayments).plus(totalPaymentComissions)

      return {
        success: true,
        deletedLoanId: loanId,
        restoredAmount: totalRestored.toString(),
        accountId,
        paymentsDeleted: payments.length,
        totalCashPayments: totalCashPayments.toString(),
        totalBankPayments: totalBankPayments.toString(),
        totalPaymentComissions: totalPaymentComissions.toString(),
      }
    })
  }

  private async generateUniqueClientCode(tx?: any): Promise<string> {
    const client = tx || this.prisma
    let code: string
    let exists: boolean

    do {
      code = generateClientCode()
      const personalData = await client.personalData.findUnique({
        where: { clientCode: code },
      })
      exists = !!personalData
    } while (exists)

    return code
  }
}
