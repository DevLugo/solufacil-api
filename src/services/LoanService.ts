import { GraphQLError } from 'graphql'
import { Decimal } from 'decimal.js'
import type { PrismaClient, LoanStatus, PaymentMethod } from '@solufacil/database'
import { LoanRepository } from '../repositories/LoanRepository'
import { LoantypeRepository } from '../repositories/LoantypeRepository'
import { BorrowerRepository } from '../repositories/BorrowerRepository'
import { EmployeeRepository } from '../repositories/EmployeeRepository'
import { AccountRepository } from '../repositories/AccountRepository'
import { TransactionRepository } from '../repositories/TransactionRepository'
import { PaymentRepository } from '../repositories/PaymentRepository'
import { PersonalDataRepository } from '../repositories/PersonalDataRepository'
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
  private transactionRepository: TransactionRepository
  private paymentRepository: PaymentRepository
  private personalDataRepository: PersonalDataRepository

  constructor(private prisma: PrismaClient) {
    this.loanRepository = new LoanRepository(prisma)
    this.loantypeRepository = new LoantypeRepository(prisma)
    this.borrowerRepository = new BorrowerRepository(prisma)
    this.employeeRepository = new EmployeeRepository(prisma)
    this.accountRepository = new AccountRepository(prisma)
    this.transactionRepository = new TransactionRepository(prisma)
    this.paymentRepository = new PaymentRepository(prisma)
    this.personalDataRepository = new PersonalDataRepository(prisma)
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
    limit?: number
    offset?: number
  }) {
    return this.loanRepository.findMany(options)
  }

  async findByWeekAndLocation(options: {
    year: number
    weekNumber: number
    locationId?: string
    limit?: number
    offset?: number
  }) {
    const weekStart = getWeekStartDate(options.year, options.weekNumber)
    const weekEnd = getWeekEndDate(options.year, options.weekNumber)

    const { loans } = await this.loanRepository.findMany({
      locationId: options.locationId,
      fromDate: weekStart,
      toDate: weekEnd,
      status: 'ACTIVE',
      limit: options.limit,
      offset: options.offset
    })

    return loans
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
    let pendingProfit = new Decimal(0)
    if (input.previousLoanId) {
      const previousLoan = await this.loanRepository.findById(input.previousLoanId)
      if (!previousLoan) {
        throw new GraphQLError('Previous loan not found', {
          extensions: { code: 'NOT_FOUND' },
        })
      }

      // Calcular el profit pendiente del préstamo anterior usando la función centralizada
      // Solo la PORCIÓN de profit de la deuda pendiente se hereda (no la deuda total)
      const { profitHeredado } = calculateProfitHeredado(
        new Decimal(previousLoan.pendingAmountStored.toString()),
        new Decimal(previousLoan.profitAmount.toString()),
        new Decimal(previousLoan.totalDebtAcquired.toString())
      )
      pendingProfit = profitHeredado

      // Marcar el préstamo anterior como RENOVATED
      await this.loanRepository.update(input.previousLoanId, {
        status: 'RENOVATED',
        renewedDate: input.signDate,
      })
    }

    // Crear snapshot histórico
    const routeId = lead.routes?.[0]?.id || undefined
    const routeName = lead.routes?.[0]?.name || undefined
    const snapshot = createLoanSnapshot(
      lead.id,
      lead.personalDataRelation?.fullName || '',
      routeId,
      routeName
    )

    // Calcular métricas finales (incluyendo profit pendiente de renovación)
    const finalProfitAmount = metrics.profitAmount.plus(pendingProfit)
    const finalTotalDebt = metrics.totalDebtAcquired.plus(pendingProfit)

    // Crear el préstamo
    return this.loanRepository.create({
      requestedAmount: requestedAmount,
      amountGived: amountGived,
      signDate: input.signDate,
      profitAmount: finalProfitAmount,
      totalDebtAcquired: finalTotalDebt,
      expectedWeeklyPayment: metrics.expectedWeeklyPayment,
      pendingAmountStored: finalTotalDebt,
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

    const routeId = lead.routes?.[0]?.id
    const routeName = lead.routes?.[0]?.name
    const snapshot = createLoanSnapshot(
      lead.id,
      lead.personalDataRelation?.fullName || '',
      routeId,
      routeName
    )

    // Ejecutar todo en una transacción
    return this.prisma.$transaction(async (tx) => {
      const createdLoans: any[] = []

      // Track first payments for LeadPaymentReceived
      const firstPaymentsCreated: {
        paymentId: string
        amount: Decimal
        commission: Decimal
        paymentMethod: 'CASH' | 'MONEY_TRANSFER'
      }[] = []

      // Track net balance effect from first payments (amount - commission)
      let totalFirstPaymentNetEffect = new Decimal(0)

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
        let pendingProfit = new Decimal(0)
        console.log('[LoanService] createLoansInBatch - loanInput.previousLoanId:', loanInput.previousLoanId)
        if (loanInput.previousLoanId) {
          console.log('[LoanService] Processing renewal for previousLoanId:', loanInput.previousLoanId)
          const previousLoan = await tx.loan.findUnique({
            where: { id: loanInput.previousLoanId },
            include: { renewedBy: true },
          })

          if (!previousLoan) {
            throw new GraphQLError(`Previous loan not found`, {
              extensions: { code: 'NOT_FOUND' },
            })
          }

          // Check if loan has already been renewed
          // Este caso no debería ocurrir si el frontend filtra correctamente (mostrando solo el préstamo más reciente)
          if (previousLoan.renewedBy) {
            throw new GraphQLError(
              `Este préstamo ya fue renovado. Por favor, recarga la página para ver los préstamos disponibles actualizados.`,
              { extensions: { code: 'BAD_USER_INPUT' } }
            )
          }

          // Calcular el profit pendiente del préstamo anterior usando la función centralizada
          // Solo la PORCIÓN de profit de la deuda pendiente se hereda (no la deuda total)
          const { profitHeredado } = calculateProfitHeredado(
            new Decimal(previousLoan.pendingAmountStored.toString()),
            new Decimal(previousLoan.profitAmount.toString()),
            new Decimal(previousLoan.totalDebtAcquired.toString())
          )
          pendingProfit = profitHeredado

          // Marcar préstamo anterior como RENOVATED y cerrado
          console.log('[LoanService] Updating previous loan to RENOVATED:', loanInput.previousLoanId)
          const updatedPreviousLoan = await tx.loan.update({
            where: { id: loanInput.previousLoanId },
            data: {
              status: 'RENOVATED',
              renewedDate: input.signDate,
              finishedDate: input.signDate,
            },
          })
          console.log('[LoanService] Previous loan updated:', updatedPreviousLoan.id, 'status:', updatedPreviousLoan.status)
        }

        // 6. Crear el préstamo
        // Note: La deuda anterior ya está descontada en amountGived
        // totalDebtAcquired y pendingAmountStored siempre son: requestedAmount + profitAmount
        const comissionAmount = loanInput.comissionAmount
          ? new Decimal(loanInput.comissionAmount)
          : new Decimal(0)

        const loan = await tx.loan.create({
          data: {
            requestedAmount,
            amountGived,
            signDate: input.signDate,
            profitAmount: metrics.profitAmount,
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

        // 7. Crear transacción EXPENSE por el monto otorgado
        const expenseTransaction = await tx.transaction.create({
          data: {
            amount: amountGived,
            date: input.signDate,
            type: 'EXPENSE',
            expenseSource: 'LOAN_GRANTED',
            sourceAccount: input.sourceAccountId,
            loan: loan.id,
            lead: input.leadId,
            route: routeId,
          },
        })
        console.log('[LoanService] Created EXPENSE transaction:', {
          id: expenseTransaction.id,
          amount: amountGived.toString(),
          sourceAccount: input.sourceAccountId,
          type: 'EXPENSE'
        })

        // 7.1. Crear transacción EXPENSE por la comisión de otorgamiento
        if (comissionAmount.greaterThan(0)) {
          const comissionTransaction = await tx.transaction.create({
            data: {
              amount: comissionAmount,
              date: input.signDate,
              type: 'EXPENSE',
              expenseSource: 'LOAN_GRANTED_COMISSION',
              sourceAccount: input.sourceAccountId,
              loan: loan.id,
              lead: input.leadId,
              route: routeId,
            },
          })
          console.log('[LoanService] Created EXPENSE transaction for comission:', {
            id: comissionTransaction.id,
            amount: comissionAmount.toString(),
            sourceAccount: input.sourceAccountId,
            type: 'EXPENSE'
          })
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

          // Track net balance effect (payment adds to balance, commission subtracts)
          totalFirstPaymentNetEffect = totalFirstPaymentNetEffect.plus(paymentAmount).minus(firstPaymentComission)
          console.log('[LoanService] First payment tracked:', {
            loanId: loan.id,
            paymentAmount: paymentAmount.toString(),
            commission: firstPaymentComission.toString(),
            netEffect: paymentAmount.minus(firstPaymentComission).toString(),
            totalNetEffectSoFar: totalFirstPaymentNetEffect.toString(),
          })

          // Crear transacción INCOME por el pago
          const incomeSource = loanInput.firstPayment.paymentMethod === 'CASH'
            ? 'CASH_LOAN_PAYMENT'
            : 'BANK_LOAN_PAYMENT'

          await tx.transaction.create({
            data: {
              amount: paymentAmount,
              date: input.signDate,
              type: 'INCOME',
              incomeSource,
              profitAmount,
              returnToCapital,
              sourceAccount: input.sourceAccountId,
              loan: loan.id,
              loanPayment: payment.id,
              lead: input.leadId,
              route: routeId,
            },
          })

          // Crear transacción EXPENSE por comisión si aplica
          if (firstPaymentComission.greaterThan(0)) {
            await tx.transaction.create({
              data: {
                amount: firstPaymentComission,
                date: input.signDate,
                type: 'EXPENSE',
                expenseSource: 'LOAN_PAYMENT_COMISSION',
                sourceAccount: input.sourceAccountId,
                loanPayment: payment.id,
                lead: input.leadId,
                route: routeId,
              },
            })
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

        // Check if there's already a LeadPaymentReceived for this day
        const paymentDate = new Date(input.signDate)
        const startOfDay = new Date(paymentDate)
        startOfDay.setHours(0, 0, 0, 0)
        const endOfDay = new Date(paymentDate)
        endOfDay.setHours(23, 59, 59, 999)

        const existingLPR = await tx.leadPaymentReceived.findFirst({
          where: {
            lead: input.leadId,
            createdAt: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
        })

        let leadPaymentReceivedId: string

        if (existingLPR) {
          // Update existing LeadPaymentReceived
          console.log('[LoanService] Existing LeadPaymentReceived found, updating...', {
            existingLPRId: existingLPR.id,
            existingPaidAmount: existingLPR.paidAmount?.toString(),
            addingTotalAmount: totalAmount.toString(),
            addingCashPaid: totalCashPaid.toString(),
            addingBankPaid: totalBankPaid.toString(),
          })
          const existingPaidAmount = new Decimal(existingLPR.paidAmount?.toString() || '0')
          const existingCashPaid = new Decimal(existingLPR.cashPaidAmount?.toString() || '0')
          const existingBankPaid = new Decimal(existingLPR.bankPaidAmount?.toString() || '0')
          const existingExpected = new Decimal(existingLPR.expectedAmount?.toString() || '0')

          await tx.leadPaymentReceived.update({
            where: { id: existingLPR.id },
            data: {
              paidAmount: existingPaidAmount.plus(totalAmount),
              cashPaidAmount: existingCashPaid.plus(totalCashPaid),
              bankPaidAmount: existingBankPaid.plus(totalBankPaid),
              expectedAmount: existingExpected.plus(totalAmount),
            },
          })
          leadPaymentReceivedId = existingLPR.id
        } else {
          // Create new LeadPaymentReceived
          const newLPR = await tx.leadPaymentReceived.create({
            data: {
              expectedAmount: totalAmount,
              paidAmount: totalAmount,
              cashPaidAmount: totalCashPaid,
              bankPaidAmount: totalBankPaid,
              paymentStatus: 'COMPLETE',
              lead: input.leadId,
              agent: input.leadId,
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

        // Update transactions to link to LeadPaymentReceived
        await tx.transaction.updateMany({
          where: {
            loanPayment: { in: firstPaymentsCreated.map((fp) => fp.paymentId) },
          },
          data: { leadPaymentReceived: leadPaymentReceivedId },
        })
      }

      // 10. Restar el monto total de la cuenta origen
      const accountBefore = await tx.account.findUnique({ where: { id: input.sourceAccountId } })
      console.log('[LoanService] ====== BALANCE ANTES ======')
      console.log('[LoanService] Balance inicial:', accountBefore?.amount?.toString())
      console.log('[LoanService] Subtracting from balance:', {
        totalAmountToDeduct: totalAmountToDeduct.toString(),
        accountId: input.sourceAccountId,
      })
      await this.accountRepository.subtractFromBalance(input.sourceAccountId, totalAmountToDeduct, tx)

      // 11. Ajustar balance por primeros pagos (el pago suma, la comisión resta)
      console.log('[LoanService] Final first payment balance adjustment:', {
        totalFirstPaymentNetEffect: totalFirstPaymentNetEffect.toString(),
        isZero: totalFirstPaymentNetEffect.isZero(),
        accountId: input.sourceAccountId,
      })
      if (!totalFirstPaymentNetEffect.isZero()) {
        await this.accountRepository.addToBalance(input.sourceAccountId, totalFirstPaymentNetEffect, tx)
        console.log('[LoanService] Balance adjusted by:', totalFirstPaymentNetEffect.toString())
      }

      const accountAfter = await tx.account.findUnique({ where: { id: input.sourceAccountId } })
      console.log('[LoanService] ====== BALANCE DESPUÉS ======')
      console.log('[LoanService] Balance final:', accountAfter?.amount?.toString())
      console.log('[LoanService] Resumen:')
      console.log('[LoanService]   - Inicial:', accountBefore?.amount?.toString())
      console.log('[LoanService]   - Restado (créditos + comisiones):', totalAmountToDeduct.toString())
      console.log('[LoanService]   - Sumado (primeros pagos neto):', totalFirstPaymentNetEffect.toString())
      console.log('[LoanService]   - Esperado:', new Decimal(accountBefore?.amount?.toString() || '0').minus(totalAmountToDeduct).plus(totalFirstPaymentNetEffect).toString())
      console.log('[LoanService]   - Final:', accountAfter?.amount?.toString())

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
      // 0. Obtener balance inicial para logging
      const accountBefore = await tx.account.findUnique({ where: { id: accountId } })
      console.log('[LoanService] ====== CANCEL LOAN - INICIO ======')
      console.log('[LoanService] Balance inicial:', accountBefore?.amount?.toString())
      console.log('[LoanService] Loan ID:', loanId)

      // 1. Obtener pagos del préstamo con su método de pago
      const payments = await tx.loanPayment.findMany({
        where: { loan: loanId },
      })
      console.log('[LoanService] Pagos encontrados:', payments.length)

      // 2. Calcular totales por tipo de pago
      let totalCashPayments = new Decimal(0)
      let totalBankPayments = new Decimal(0)
      let totalPaymentComissions = new Decimal(0)

      for (const payment of payments) {
        const paymentAmount = new Decimal(payment.amount.toString())
        const paymentComission = new Decimal(payment.comission?.toString() || '0')
        console.log('[LoanService] Pago:', {
          id: payment.id,
          amount: paymentAmount.toString(),
          comission: paymentComission.toString(),
          method: payment.paymentMethod,
        })

        if (payment.paymentMethod === 'MONEY_TRANSFER') {
          totalBankPayments = totalBankPayments.plus(paymentAmount)
        } else {
          totalCashPayments = totalCashPayments.plus(paymentAmount)
        }
        totalPaymentComissions = totalPaymentComissions.plus(paymentComission)
      }

      // 3. Calcular monto a restaurar a cuenta de ruta
      // = amountGived + loanGrantedComission - cashPayments + paymentComissions
      // NOTA: loanGrantedComission es solo la comisión de otorgamiento (NO incluye comisiones de pagos)
      // Las comisiones de pagos ya están en totalPaymentComissions (obtenidas de loanPayment.comission)
      const amountGived = new Decimal(loan.amountGived.toString())
      const loanGrantedComission = new Decimal(loan.comissionAmount?.toString() || '0')
      console.log('[LoanService] Cálculo de restauración:')
      console.log('[LoanService]   - amountGived:', amountGived.toString())
      console.log('[LoanService]   - loanGrantedComission (del loan):', loanGrantedComission.toString())
      console.log('[LoanService]   - totalCashPayments:', totalCashPayments.toString())
      console.log('[LoanService]   - totalBankPayments:', totalBankPayments.toString())
      console.log('[LoanService]   - totalPaymentComissions:', totalPaymentComissions.toString())

      const totalToRestoreToRouteAccount = amountGived
        .plus(loanGrantedComission)
        .minus(totalCashPayments)
        .plus(totalPaymentComissions)
      console.log('[LoanService]   - totalToRestore:', totalToRestoreToRouteAccount.toString())
      console.log('[LoanService]   - Fórmula: amountGived + loanGrantedComission - cashPayments + paymentComissions')
      console.log('[LoanService]   - Cálculo:', `${amountGived} + ${loanGrantedComission} - ${totalCashPayments} + ${totalPaymentComissions} = ${totalToRestoreToRouteAccount}`)

      // 4. Eliminar pagos y sus transacciones
      for (const payment of payments) {
        await tx.transaction.deleteMany({
          where: { loanPayment: payment.id },
        })
        await tx.loanPayment.delete({
          where: { id: payment.id },
        })
      }

      // 5. Eliminar transacciones del préstamo (EXPENSE de LOAN_GRANTED, etc.)
      await tx.transaction.deleteMany({
        where: { loan: loanId },
      })

      // 6. Crear transacción de restauración para cuenta de ruta (INCOME)
      if (!totalToRestoreToRouteAccount.isZero()) {
        await tx.transaction.create({
          data: {
            amount: totalToRestoreToRouteAccount.abs(),
            date: new Date(),
            type: totalToRestoreToRouteAccount.isPositive() ? 'INCOME' : 'EXPENSE',
            incomeSource: totalToRestoreToRouteAccount.isPositive() ? 'LOAN_CANCELLED_RESTORE' : undefined,
            expenseSource: totalToRestoreToRouteAccount.isNegative() ? 'LOAN_CANCELLED_ADJUSTMENT' : undefined,
            sourceAccount: accountId,
            lead: loan.lead || undefined,
            route: loan.snapshotRouteId || undefined,
          },
        })
      }

      // 7. Restaurar/ajustar el balance de la cuenta de ruta
      if (totalToRestoreToRouteAccount.isPositive()) {
        console.log('[LoanService] Restaurando al balance:', totalToRestoreToRouteAccount.toString())
        await this.accountRepository.addToBalance(accountId, totalToRestoreToRouteAccount, tx)
      } else if (totalToRestoreToRouteAccount.isNegative()) {
        console.log('[LoanService] Restando del balance:', totalToRestoreToRouteAccount.abs().toString())
        await this.accountRepository.subtractFromBalance(accountId, totalToRestoreToRouteAccount.abs(), tx)
      }

      // Log balance después de restaurar
      const accountAfterRestore = await tx.account.findUnique({ where: { id: accountId } })
      console.log('[LoanService] Balance después de restaurar:', accountAfterRestore?.amount?.toString())

      // 8. Si hay pagos bancarios, revertir del banco
      if (totalBankPayments.greaterThan(0)) {
        // Buscar cuenta de banco de la ruta
        const bankAccount = await tx.account.findFirst({
          where: {
            type: 'BANK',
            routes: {
              some: { id: loan.snapshotRouteId || undefined },
            },
          },
        })

        if (bankAccount) {
          await tx.transaction.create({
            data: {
              amount: totalBankPayments,
              date: new Date(),
              type: 'EXPENSE',
              expenseSource: 'LOAN_CANCELLED_BANK_REVERSAL',
              sourceAccount: bankAccount.id,
              lead: loan.lead || undefined,
              route: loan.snapshotRouteId || undefined,
            },
          })
          await this.accountRepository.subtractFromBalance(bankAccount.id, totalBankPayments, tx)
        }
      }

      // 9. Si es renovación, reactivar el préstamo anterior
      if (loan.previousLoan) {
        await tx.loan.update({
          where: { id: loan.previousLoan },
          data: {
            status: 'ACTIVE',
            renewedDate: null,
            finishedDate: null,
          },
        })
      }

      // 10. Eliminar el préstamo
      await tx.loan.update({
        where: { id: loanId },
        data: { collaterals: { set: [] } },
      })

      await tx.loan.delete({
        where: { id: loanId },
      })

      // Log balance final
      const accountFinal = await tx.account.findUnique({ where: { id: accountId } })
      console.log('[LoanService] ====== CANCEL LOAN - FIN ======')
      console.log('[LoanService] Balance final:', accountFinal?.amount?.toString())
      console.log('[LoanService] Resumen:')
      console.log('[LoanService]   - Balance inicial:', accountBefore?.amount?.toString())
      console.log('[LoanService]   - Monto restaurado:', totalToRestoreToRouteAccount.toString())
      console.log('[LoanService]   - Balance final:', accountFinal?.amount?.toString())
      console.log('[LoanService]   - Diferencia real:', new Decimal(accountFinal?.amount?.toString() || '0').minus(new Decimal(accountBefore?.amount?.toString() || '0')).toString())

      // Retornar información detallada
      return {
        success: true,
        deletedLoanId: loanId,
        restoredAmount: totalToRestoreToRouteAccount.toString(),
        accountId,
        // Nuevos campos para mostrar en el dialog
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
