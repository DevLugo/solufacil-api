import { GraphQLError } from 'graphql'
import { Decimal } from 'decimal.js'
import type { PrismaClient, PaymentMethod } from '@solufacil/database'
import { PaymentRepository } from '../repositories/PaymentRepository'
import { LoanRepository } from '../repositories/LoanRepository'
import { TransactionRepository } from '../repositories/TransactionRepository'
import { AccountRepository } from '../repositories/AccountRepository'
import { calculatePaymentProfit } from '@solufacil/business-logic'

export interface CreateLoanPaymentInput {
  loanId: string
  amount: string | number
  comission?: string | number
  receivedAt: Date
  paymentMethod: PaymentMethod
}

export interface CreateLeadPaymentReceivedInput {
  leadId: string
  agentId: string
  expectedAmount: string | number
  paidAmount: string | number
  cashPaidAmount: string | number
  bankPaidAmount: string | number
  falcoAmount?: string | number
  paymentDate: Date | string
  payments: {
    loanId: string
    amount: string | number
    comission?: string | number
    paymentMethod: PaymentMethod
  }[]
}

export interface UpdateLoanPaymentInput {
  amount?: string | number
  comission?: string | number
  paymentMethod?: PaymentMethod
}

export interface UpdateLeadPaymentReceivedInput {
  expectedAmount?: string | number
  paidAmount?: string | number
  cashPaidAmount?: string | number
  bankPaidAmount?: string | number
  falcoAmount?: string | number
  // When true, only update distribution (cash/bank split) without processing payments
  // This is a simpler path that just updates the record and adjusts account balances
  distributionOnlyChange?: boolean
  payments?: {
    paymentId?: string
    loanId: string
    amount: string | number
    comission?: string | number
    paymentMethod: PaymentMethod
    isDeleted?: boolean
  }[]
}

export class PaymentService {
  private paymentRepository: PaymentRepository
  private loanRepository: LoanRepository
  private transactionRepository: TransactionRepository
  private accountRepository: AccountRepository

  constructor(private prisma: PrismaClient) {
    this.paymentRepository = new PaymentRepository(prisma)
    this.loanRepository = new LoanRepository(prisma)
    this.transactionRepository = new TransactionRepository(prisma)
    this.accountRepository = new AccountRepository(prisma)
  }

  async findByLoanId(loanId: string, options?: { limit?: number; offset?: number }) {
    return this.paymentRepository.findByLoanId(loanId, options)
  }

  async createLoanPayment(input: CreateLoanPaymentInput) {
    // Obtener el préstamo
    const loan = await this.loanRepository.findById(input.loanId)
    if (!loan) {
      throw new GraphQLError('Loan not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const paymentAmount = new Decimal(input.amount)
    // Use commission from input, otherwise default to loantype's loanPaymentComission
    const comission = input.comission !== undefined
      ? new Decimal(input.comission)
      : loan.loantypeRelation?.loanPaymentComission
        ? new Decimal(loan.loantypeRelation.loanPaymentComission.toString())
        : new Decimal(0)

    // Calcular profit del pago
    const totalProfit = new Decimal(loan.profitAmount.toString())
    const totalDebt = new Decimal(loan.totalDebtAcquired.toString())
    const isBadDebt = !!loan.badDebtDate

    const { profitAmount, returnToCapital } = calculatePaymentProfit(
      paymentAmount,
      totalProfit,
      totalDebt,
      isBadDebt
    )

    // Ejecutar en transacción
    return this.prisma.$transaction(async (tx) => {
      // Crear el pago
      const payment = await this.paymentRepository.create(
        {
          amount: paymentAmount,
          comission,
          receivedAt: input.receivedAt,
          paymentMethod: input.paymentMethod,
          type: 'PAYMENT',
          loan: input.loanId,
        },
        tx
      )

      // Obtener cuenta del lead
      const leadAccount = await this.getLeadAccount(loan.lead || '', tx)

      // Crear transacción de ingreso
      const incomeSource = input.paymentMethod === 'CASH'
        ? 'CASH_LOAN_PAYMENT'
        : 'BANK_LOAN_PAYMENT'

      await this.transactionRepository.create(
        {
          amount: paymentAmount,
          date: input.receivedAt,
          type: 'INCOME',
          incomeSource,
          profitAmount,
          returnToCapital,
          sourceAccountId: leadAccount.id,
          loanId: loan.id,
          loanPaymentId: payment.id,
          leadId: loan.lead || undefined,
          routeId: loan.snapshotRouteId || undefined,
        },
        tx
      )

      // Crear transacción de comisión si aplica
      if (comission.greaterThan(0)) {
        await this.transactionRepository.create(
          {
            amount: comission,
            date: input.receivedAt,
            type: 'EXPENSE',
            expenseSource: 'LOAN_PAYMENT_COMISSION',
            sourceAccountId: leadAccount.id,
            loanPaymentId: payment.id,
            leadId: loan.lead || undefined,
          },
          tx
        )
      }

      // Actualizar métricas del préstamo
      const currentTotalPaid = new Decimal(loan.totalPaid.toString())
      const currentPending = new Decimal(loan.pendingAmountStored.toString())

      const updatedTotalPaid = currentTotalPaid.plus(paymentAmount)
      const updatedPending = currentPending.minus(paymentAmount)

      const updateData: Parameters<typeof this.loanRepository.update>[1] = {
        totalPaid: updatedTotalPaid,
        pendingAmountStored: updatedPending.isNegative() ? new Decimal(0) : updatedPending,
        comissionAmount: new Decimal(loan.comissionAmount.toString()).plus(comission),
      }

      // Si ya está pagado, marcar como FINISHED
      if (updatedPending.lessThanOrEqualTo(0)) {
        updateData.status = 'FINISHED'
        updateData.finishedDate = new Date()
      }

      await tx.loan.update({
        where: { id: loan.id },
        data: updateData,
      })

      // Actualizar balance: sumar pago, restar comisión
      const netPaymentAmount = paymentAmount.minus(comission)
      await this.accountRepository.addToBalance(leadAccount.id, netPaymentAmount, tx)

      return payment
    })
  }

  async createLeadPaymentReceived(input: CreateLeadPaymentReceivedInput) {
    const expectedAmount = new Decimal(input.expectedAmount)
    const paidAmount = new Decimal(input.paidAmount)
    const cashPaidAmount = new Decimal(input.cashPaidAmount)
    const bankPaidAmount = new Decimal(input.bankPaidAmount)
    const falcoAmount = input.falcoAmount ? new Decimal(input.falcoAmount) : new Decimal(0)
    const paymentDate = new Date(input.paymentDate)

    const paymentStatus = paidAmount.greaterThanOrEqualTo(expectedAmount)
      ? 'COMPLETE'
      : 'PARTIAL'

    return this.prisma.$transaction(async (tx) => {
      // 1. Obtener cuentas del agente (EMPLOYEE_CASH_FUND y BANK)
      const agent = await tx.employee.findUnique({
        where: { id: input.agentId },
        include: {
          routes: {
            include: {
              accounts: {
                where: {
                  type: { in: ['EMPLOYEE_CASH_FUND', 'BANK'] }
                }
              }
            }
          }
        }
      })

      const agentAccounts = agent?.routes?.flatMap(r => r.accounts) || []
      const cashAccount = agentAccounts.find(a => a.type === 'EMPLOYEE_CASH_FUND')
      const bankAccount = agentAccounts.find(a => a.type === 'BANK')

      // Obtener routeId para las transacciones
      const routeId = agent?.routes?.[0]?.id

      // 2. Crear el registro de pago del lead
      const leadPaymentReceived = await this.paymentRepository.createLeadPaymentReceived({
        expectedAmount,
        paidAmount,
        cashPaidAmount,
        bankPaidAmount,
        falcoAmount,
        paymentStatus,
        lead: input.leadId,
        agent: input.agentId,
        createdAt: paymentDate,
      })

      // 3. Acumuladores para cambios en cuentas
      let cashAmountChange = new Decimal(0)
      let bankAmountChange = new Decimal(0)

      console.log('[PaymentService] ===== CREATE LeadPaymentReceived =====')
      console.log('[PaymentService] Input summary:', {
        leadId: input.leadId,
        expectedAmount: expectedAmount.toString(),
        paidAmount: paidAmount.toString(),
        cashPaidAmount: cashPaidAmount.toString(),
        bankPaidAmount: bankPaidAmount.toString(),
        falcoAmount: falcoAmount.toString(),
        paymentsCount: input.payments.length,
      })

      // 4. Crear los pagos individuales y transacciones
      for (const paymentInput of input.payments) {
        const loan = await this.loanRepository.findById(paymentInput.loanId)
        if (!loan) continue

        const paymentAmount = new Decimal(paymentInput.amount)
        // Use commission from input, otherwise default to loantype's loanPaymentComission
        const comissionAmount = paymentInput.comission !== undefined
          ? new Decimal(paymentInput.comission)
          : loan.loantypeRelation?.loanPaymentComission
            ? new Decimal(loan.loantypeRelation.loanPaymentComission.toString())
            : new Decimal(0)

        // Calcular profit y return to capital
        const totalProfit = new Decimal(loan.profitAmount.toString())
        const totalDebt = new Decimal(loan.totalDebtAcquired.toString())
        const isBadDebt = !!loan.badDebtDate

        const { profitAmount, returnToCapital } = calculatePaymentProfit(
          paymentAmount,
          totalProfit,
          totalDebt,
          isBadDebt
        )

        // Crear el pago
        const payment = await this.paymentRepository.create(
          {
            amount: paymentAmount,
            comission: comissionAmount.greaterThan(0) ? comissionAmount : undefined,
            receivedAt: paymentDate,
            paymentMethod: paymentInput.paymentMethod,
            type: 'PAYMENT',
            loan: paymentInput.loanId,
            leadPaymentReceived: leadPaymentReceived.id,
          },
          tx
        )

        // Determinar cuenta destino según método de pago
        const isTransfer = paymentInput.paymentMethod === 'MONEY_TRANSFER'
        const destinationAccountId = isTransfer ? bankAccount?.id : cashAccount?.id

        // Crear transacción INCOME (suma a la cuenta)
        if (destinationAccountId) {
          await this.transactionRepository.create(
            {
              amount: paymentAmount,
              date: paymentDate,
              type: 'INCOME',
              incomeSource: isTransfer ? 'BANK_LOAN_PAYMENT' : 'CASH_LOAN_PAYMENT',
              profitAmount,
              returnToCapital,
              destinationAccountId,
              loanId: loan.id,
              loanPaymentId: payment.id,
              leadId: input.leadId,
              routeId,
              leadPaymentReceivedId: leadPaymentReceived.id,
            },
            tx
          )
        }

        // Acumular cambio según método de pago
        console.log('[PaymentService] Processing payment:', {
          loanId: paymentInput.loanId,
          amount: paymentAmount.toString(),
          comission: comissionAmount.toString(),
          method: paymentInput.paymentMethod,
          isTransfer,
        })

        if (isTransfer) {
          bankAmountChange = bankAmountChange.plus(paymentAmount)
          console.log('[PaymentService]   -> bankAmountChange += ' + paymentAmount.toString() + ' = ' + bankAmountChange.toString())
        } else {
          cashAmountChange = cashAmountChange.plus(paymentAmount)
          console.log('[PaymentService]   -> cashAmountChange += ' + paymentAmount.toString() + ' = ' + cashAmountChange.toString())
        }

        // Crear transacción EXPENSE por comisión (resta de la cuenta de efectivo)
        if (comissionAmount.greaterThan(0) && cashAccount) {
          await this.transactionRepository.create(
            {
              amount: comissionAmount,
              date: paymentDate,
              type: 'EXPENSE',
              expenseSource: 'LOAN_PAYMENT_COMISSION',
              sourceAccountId: cashAccount.id,
              loanPaymentId: payment.id,
              leadId: input.leadId,
              routeId,
            },
            tx
          )
          // La comisión siempre se descuenta de efectivo
          cashAmountChange = cashAmountChange.minus(comissionAmount)
          console.log('[PaymentService]   -> cashAmountChange -= ' + comissionAmount.toString() + ' (comision) = ' + cashAmountChange.toString())
        }

        // Actualizar métricas del préstamo
        const currentTotalPaid = new Decimal(loan.totalPaid.toString())
        const currentPending = new Decimal(loan.pendingAmountStored.toString())
        const updatedPending = currentPending.minus(paymentAmount)

        await tx.loan.update({
          where: { id: loan.id },
          data: {
            totalPaid: currentTotalPaid.plus(paymentAmount),
            pendingAmountStored: updatedPending.isNegative() ? new Decimal(0) : updatedPending,
            comissionAmount: { increment: comissionAmount },
            ...(updatedPending.lessThanOrEqualTo(0) && {
              status: 'FINISHED',
              finishedDate: paymentDate,
            }),
          },
        })
      }

      // 5. Calcular si el líder depositó efectivo al banco
      // bankPaidAmount = total que terminó en banco
      // bankAmountChange = pagos que fueron directo por MONEY_TRANSFER
      // La diferencia = efectivo que el líder depositó al banco
      const cashToBank = bankPaidAmount.minus(bankAmountChange)

      console.log('[PaymentService] Distribution calculation:')
      console.log('[PaymentService]   bankPaidAmount (total al banco):', bankPaidAmount.toString())
      console.log('[PaymentService]   bankAmountChange (pagos MONEY_TRANSFER):', bankAmountChange.toString())
      console.log('[PaymentService]   cashToBank (efectivo depositado):', cashToBank.toString())

      if (cashToBank.greaterThan(0) && cashAccount && bankAccount) {
        // Crear transacción TRANSFER por el efectivo depositado al banco
        await this.transactionRepository.create(
          {
            amount: cashToBank,
            date: paymentDate,
            type: 'TRANSFER',
            sourceAccountId: cashAccount.id,
            destinationAccountId: bankAccount.id,
            leadId: input.leadId,
            routeId,
            leadPaymentReceivedId: leadPaymentReceived.id,
          },
          tx
        )
        // Ajustar el cambio: restar de efectivo, sumar a banco
        cashAmountChange = cashAmountChange.minus(cashToBank)
        bankAmountChange = bankAmountChange.plus(cashToBank)
        console.log('[PaymentService]   After transfer: cashAmountChange =', cashAmountChange.toString())
        console.log('[PaymentService]   After transfer: bankAmountChange =', bankAmountChange.toString())
      }

      // 5.5 Si hay falco, crear transacción FALCO_LOSS y descontar del balance
      if (falcoAmount.greaterThan(0) && cashAccount) {
        // Crear transacción de pérdida por falco (EXPENSE que reduce el balance)
        await this.transactionRepository.create(
          {
            amount: falcoAmount,
            date: paymentDate,
            type: 'EXPENSE',
            expenseSource: 'FALCO_LOSS',
            description: `Pérdida por falco - ${leadPaymentReceived.id}`,
            sourceAccountId: cashAccount.id,
            leadId: input.leadId,
            routeId,
            leadPaymentReceivedId: leadPaymentReceived.id,
          },
          tx
        )
        // Descontar el falco del balance de efectivo
        cashAmountChange = cashAmountChange.minus(falcoAmount)
        console.log('[PaymentService] Falco applied: cashAmountChange -= ' + falcoAmount.toString() + ' = ' + cashAmountChange.toString())
      }

      // 6. Actualizar balances de cuentas con los montos acumulados
      console.log('[PaymentService] ===== FINAL BALANCE CHANGES =====')
      console.log('[PaymentService] cashAmountChange to apply:', cashAmountChange.toString())
      console.log('[PaymentService] bankAmountChange to apply:', bankAmountChange.toString())

      if (cashAccount && !cashAmountChange.isZero()) {
        const beforeCash = await tx.account.findUnique({ where: { id: cashAccount.id } })
        console.log('[PaymentService] Cash balance BEFORE:', beforeCash?.amount?.toString())
        await this.accountRepository.addToBalance(cashAccount.id, cashAmountChange, tx)
        const afterCash = await tx.account.findUnique({ where: { id: cashAccount.id } })
        console.log('[PaymentService] Cash balance AFTER:', afterCash?.amount?.toString())
      }

      if (bankAccount && !bankAmountChange.isZero()) {
        const beforeBank = await tx.account.findUnique({ where: { id: bankAccount.id } })
        console.log('[PaymentService] Bank balance BEFORE:', beforeBank?.amount?.toString())
        await this.accountRepository.addToBalance(bankAccount.id, bankAmountChange, tx)
        const afterBank = await tx.account.findUnique({ where: { id: bankAccount.id } })
        console.log('[PaymentService] Bank balance AFTER:', afterBank?.amount?.toString())
      }

      console.log('[PaymentService] ===== END CREATE =====')


      return leadPaymentReceived
    })
  }

  private async getLeadAccount(leadId: string, tx?: any): Promise<{ id: string }> {
    const client = tx || this.prisma

    // Buscar cuenta del empleado tipo EMPLOYEE_CASH_FUND
    const account = await client.account.findFirst({
      where: {
        type: 'EMPLOYEE_CASH_FUND',
        routes: {
          some: {
            employees: {
              some: { id: leadId },
            },
          },
        },
      },
    })

    if (!account) {
      // Si no existe, buscar cualquier cuenta de oficina
      const officeAccount = await client.account.findFirst({
        where: { type: 'OFFICE_CASH_FUND' },
      })

      if (!officeAccount) {
        throw new GraphQLError('No account found for lead', {
          extensions: { code: 'NOT_FOUND' },
        })
      }

      return officeAccount
    }

    return account
  }

  async updateLoanPayment(id: string, input: UpdateLoanPaymentInput) {
    // Obtener el pago existente
    const existingPayment = await this.paymentRepository.findById(id)
    if (!existingPayment) {
      throw new GraphQLError('Payment not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const loan = existingPayment.loanRelation
    const oldAmount = new Decimal(existingPayment.amount.toString())
    const newAmount = input.amount ? new Decimal(input.amount) : oldAmount
    const amountDiff = newAmount.minus(oldAmount)

    const oldComission = new Decimal(existingPayment.comission.toString())
    const newComission = input.comission !== undefined ? new Decimal(input.comission) : oldComission
    const comissionDiff = newComission.minus(oldComission)

    return this.prisma.$transaction(async (tx) => {
      // Actualizar el pago
      const updatedPayment = await this.paymentRepository.update(
        id,
        {
          amount: input.amount ? newAmount : undefined,
          comission: input.comission !== undefined ? newComission : undefined,
          paymentMethod: input.paymentMethod,
        },
        tx
      )

      // Actualizar métricas del préstamo si cambió el monto
      if (!amountDiff.isZero()) {
        const currentTotalPaid = new Decimal(loan.totalPaid.toString())
        const currentPending = new Decimal(loan.pendingAmountStored.toString())

        await tx.loan.update({
          where: { id: loan.id },
          data: {
            totalPaid: currentTotalPaid.plus(amountDiff),
            pendingAmountStored: currentPending.minus(amountDiff),
          },
        })
      }

      // Actualizar comisiones del préstamo si cambió
      if (!comissionDiff.isZero()) {
        const currentComission = new Decimal(loan.comissionAmount.toString())
        await tx.loan.update({
          where: { id: loan.id },
          data: {
            comissionAmount: currentComission.plus(comissionDiff),
          },
        })
      }

      // Actualizar transacciones asociadas (incluyendo recálculo de profitAmount)
      if (input.amount || input.paymentMethod) {
        const incomeSource = (input.paymentMethod || existingPayment.paymentMethod) === 'CASH'
          ? 'CASH_LOAN_PAYMENT'
          : 'BANK_LOAN_PAYMENT'

        // Recalcular profitAmount y returnToCapital si cambió el monto
        const totalProfit = new Decimal(loan.profitAmount.toString())
        const totalDebt = new Decimal(loan.totalDebtAcquired.toString())
        const isBadDebt = !!loan.badDebtDate

        const { profitAmount, returnToCapital } = calculatePaymentProfit(
          newAmount,
          totalProfit,
          totalDebt,
          isBadDebt
        )

        await tx.transaction.updateMany({
          where: {
            loanPayment: id,
            type: 'INCOME',
          },
          data: {
            amount: newAmount,
            incomeSource,
            profitAmount,
            returnToCapital,
          },
        })
      }

      // Actualizar transacción de comisión
      if (input.comission !== undefined) {
        if (newComission.isZero()) {
          // Eliminar transacción de comisión si existe
          await tx.transaction.deleteMany({
            where: {
              loanPayment: id,
              type: 'EXPENSE',
              expenseSource: 'LOAN_PAYMENT_COMISSION',
            },
          })
        } else {
          // Actualizar o crear transacción de comisión
          const existingComissionTx = await tx.transaction.findFirst({
            where: {
              loanPayment: id,
              type: 'EXPENSE',
              expenseSource: 'LOAN_PAYMENT_COMISSION',
            },
          })

          if (existingComissionTx) {
            await tx.transaction.update({
              where: { id: existingComissionTx.id },
              data: { amount: newComission },
            })
          }
          // Note: If there was no comission tx before and now there is, we don't create it
          // because the original payment flow handles that
        }
      }

      // Ajustar balance: amountDiff (INCOME) - comissionDiff (EXPENSE)
      const netBalanceChange = amountDiff.minus(comissionDiff)
      if (!netBalanceChange.isZero()) {
        const leadAccount = await this.getLeadAccount(loan.lead || '', tx)
        await this.accountRepository.addToBalance(leadAccount.id, netBalanceChange, tx)
      }

      return updatedPayment
    })
  }

  async deleteLoanPayment(id: string) {
    // Obtener el pago existente
    const existingPayment = await this.paymentRepository.findById(id)
    if (!existingPayment) {
      throw new GraphQLError('Payment not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const loan = existingPayment.loanRelation
    const amount = new Decimal(existingPayment.amount.toString())
    const comission = new Decimal(existingPayment.comission.toString())

    return this.prisma.$transaction(async (tx) => {
      // Eliminar transacciones asociadas primero
      await tx.transaction.deleteMany({
        where: { loanPayment: id },
      })

      // Eliminar el pago
      const deletedPayment = await this.paymentRepository.delete(id, tx)

      // Revertir métricas del préstamo
      const currentTotalPaid = new Decimal(loan.totalPaid.toString())
      const currentPending = new Decimal(loan.pendingAmountStored.toString())
      const currentComission = new Decimal(loan.comissionAmount.toString())

      await tx.loan.update({
        where: { id: loan.id },
        data: {
          totalPaid: currentTotalPaid.minus(amount),
          pendingAmountStored: currentPending.plus(amount),
          comissionAmount: currentComission.minus(comission),
          // Si estaba terminado, volver a activar
          status: 'ACTIVE',
          finishedDate: null,
        },
      })

      // Revertir balance: restar el pago (INCOME), sumar la comisión (EXPENSE)
      const netRevert = comission.minus(amount)
      const leadAccount = await this.getLeadAccount(loan.lead || '', tx)
      await this.accountRepository.addToBalance(leadAccount.id, netRevert, tx)

      return deletedPayment
    })
  }

  async updateLeadPaymentReceived(id: string, input: UpdateLeadPaymentReceivedInput) {
    console.log('[PaymentService] ===== UPDATE START =====')
    console.log('[PaymentService] ID:', id)
    console.log('[PaymentService] Input:', JSON.stringify({
      expectedAmount: input.expectedAmount,
      paidAmount: input.paidAmount,
      cashPaidAmount: input.cashPaidAmount,
      bankPaidAmount: input.bankPaidAmount,
      falcoAmount: input.falcoAmount,
      paymentCount: input.payments?.length || 0,
      payments: input.payments?.map(p => ({
        paymentId: p.paymentId,
        loanId: p.loanId,
        amount: p.amount,
        comission: p.comission,
        paymentMethod: p.paymentMethod,
        isDeleted: p.isDeleted,
      })),
    }, null, 2))

    // Obtener el LeadPaymentReceived existente
    const existingRecord = await this.paymentRepository.findLeadPaymentReceivedById(id)
    if (!existingRecord) {
      throw new GraphQLError('LeadPaymentReceived not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    console.log('[PaymentService] Existing record:', {
      expectedAmount: existingRecord.expectedAmount.toString(),
      paidAmount: existingRecord.paidAmount.toString(),
      cashPaidAmount: existingRecord.cashPaidAmount.toString(),
      bankPaidAmount: existingRecord.bankPaidAmount.toString(),
      falcoAmount: existingRecord.falcoAmount.toString(),
      paymentCount: existingRecord.payments.length,
    })

    // SPECIAL PATH: Distribution-only change (no payment modifications)
    // This is a simpler path that just updates the distribution and adjusts balances
    if (input.distributionOnlyChange && input.cashPaidAmount !== undefined && input.bankPaidAmount !== undefined) {
      console.log('[PaymentService] ===== DISTRIBUTION-ONLY CHANGE =====')

      const oldCashPaid = new Decimal(existingRecord.cashPaidAmount.toString())
      const oldBankPaid = new Decimal(existingRecord.bankPaidAmount.toString())
      const newCashPaid = new Decimal(input.cashPaidAmount)
      const newBankPaid = new Decimal(input.bankPaidAmount)

      const cashDelta = newCashPaid.minus(oldCashPaid)
      const bankDelta = newBankPaid.minus(oldBankPaid)

      console.log('[PaymentService] Distribution change:', {
        old: { cash: oldCashPaid.toString(), bank: oldBankPaid.toString() },
        new: { cash: newCashPaid.toString(), bank: newBankPaid.toString() },
        delta: { cash: cashDelta.toString(), bank: bankDelta.toString() },
      })

      return this.prisma.$transaction(async (tx) => {
        // Get agent accounts
        const agent = await tx.employee.findUnique({
          where: { id: existingRecord.agent },
          include: {
            routes: {
              include: {
                accounts: {
                  where: { type: { in: ['EMPLOYEE_CASH_FUND', 'BANK'] } }
                }
              }
            }
          }
        })

        const agentAccounts = agent?.routes?.flatMap(r => r.accounts) || []
        const cashAccount = agentAccounts.find(a => a.type === 'EMPLOYEE_CASH_FUND')
        const bankAccount = agentAccounts.find(a => a.type === 'BANK')

        // Get routeId from existing transactions or agent's routes
        const existingIncomeTx = await tx.transaction.findFirst({
          where: { leadPaymentReceived: id, type: 'INCOME' },
          select: { route: true },
        })
        const routeId = existingIncomeTx?.route || agent?.routes?.[0]?.id || ''

        // Update account balances by the delta
        if (cashAccount && !cashDelta.isZero()) {
          console.log('[PaymentService] Updating cash account balance by:', cashDelta.toString())
          await this.accountRepository.addToBalance(cashAccount.id, cashDelta, tx)
        }

        if (bankAccount && !bankDelta.isZero()) {
          console.log('[PaymentService] Updating bank account balance by:', bankDelta.toString())
          await this.accountRepository.addToBalance(bankAccount.id, bankDelta, tx)
        }

        // Handle TRANSFER transaction
        // Calculate how much of the cash is being "transferred to bank" by the leader
        // (vs money that was paid directly by clients via MONEY_TRANSFER)
        const moneyTransferSum = existingRecord.payments
          .filter(p => p.paymentMethod === 'MONEY_TRANSFER')
          .reduce((sum, p) => sum.plus(new Decimal(p.amount.toString())), new Decimal(0))

        const oldCashToBank = oldBankPaid.minus(moneyTransferSum)
        const newCashToBank = newBankPaid.minus(moneyTransferSum)

        console.log('[PaymentService] TRANSFER transaction:', {
          moneyTransferSum: moneyTransferSum.toString(),
          oldCashToBank: oldCashToBank.toString(),
          newCashToBank: newCashToBank.toString(),
        })

        // Always check for existing TRANSFER first to prevent duplicates
        // (handles case where frontend might have stale data)
        const existingTransferTx = await tx.transaction.findFirst({
          where: { leadPaymentReceived: id, type: 'TRANSFER' },
        })

        console.log('[PaymentService] Existing TRANSFER:', existingTransferTx?.id || 'none',
          existingTransferTx ? `amount: ${existingTransferTx.amount}` : '')

        if (newCashToBank.isZero()) {
          // No transfer needed - delete if exists
          if (existingTransferTx) {
            console.log('[PaymentService] Deleting TRANSFER transaction (no longer needed)')
            await tx.transaction.delete({ where: { id: existingTransferTx.id } })
          }
        } else if (existingTransferTx) {
          // TRANSFER exists - update it with new amount
          if (!new Decimal(existingTransferTx.amount.toString()).equals(newCashToBank)) {
            console.log('[PaymentService] Updating TRANSFER transaction:', newCashToBank.toString())
            await tx.transaction.update({
              where: { id: existingTransferTx.id },
              data: { amount: newCashToBank },
            })
          } else {
            console.log('[PaymentService] TRANSFER amount unchanged, skipping update')
          }
        } else if (cashAccount && bankAccount) {
          // No TRANSFER exists and we need one - create it
          console.log('[PaymentService] Creating TRANSFER transaction:', newCashToBank.toString())
          await this.transactionRepository.create({
            amount: newCashToBank,
            date: existingRecord.createdAt, // Use the original LeadPaymentReceived date
            type: 'TRANSFER',
            sourceAccountId: cashAccount.id,
            destinationAccountId: bankAccount.id,
            leadId: existingRecord.lead,
            routeId: routeId || '',
            leadPaymentReceivedId: id,
          }, tx)
        }

        // Update the LeadPaymentReceived record
        const updatedRecord = await tx.leadPaymentReceived.update({
          where: { id },
          data: {
            cashPaidAmount: newCashPaid,
            bankPaidAmount: newBankPaid,
          },
          include: { payments: true },
        })

        console.log('[PaymentService] ===== DISTRIBUTION-ONLY CHANGE COMPLETE =====')
        return updatedRecord
      })
    }

    const expectedAmount = input.expectedAmount !== undefined
      ? new Decimal(input.expectedAmount)
      : new Decimal(existingRecord.expectedAmount.toString())
    const paidAmount = input.paidAmount !== undefined
      ? new Decimal(input.paidAmount)
      : new Decimal(existingRecord.paidAmount.toString())
    const cashPaidAmount = input.cashPaidAmount !== undefined
      ? new Decimal(input.cashPaidAmount)
      : new Decimal(existingRecord.cashPaidAmount.toString())
    const bankPaidAmount = input.bankPaidAmount !== undefined
      ? new Decimal(input.bankPaidAmount)
      : new Decimal(existingRecord.bankPaidAmount.toString())
    const falcoAmount = input.falcoAmount !== undefined
      ? new Decimal(input.falcoAmount)
      : new Decimal(existingRecord.falcoAmount.toString())

    // Check if any payments are being deleted
    const hasAnyDeletion = input.payments?.some(p => p.isDeleted) || false

    // IMPORTANT: Track if distribution was explicitly changed
    // Distribution is considered changed if:
    // 1. bankPaidAmount/cashPaidAmount are explicitly in the input, OR
    // 2. Any payments are being deleted (which implicitly changes distribution)
    const distributionExplicitlyChanged = input.bankPaidAmount !== undefined || input.cashPaidAmount !== undefined
    const distributionChanged = distributionExplicitlyChanged || hasAnyDeletion
    console.log('[PaymentService] Distribution explicitly changed:', distributionExplicitlyChanged)
    console.log('[PaymentService] Has any deletion:', hasAnyDeletion)
    console.log('[PaymentService] Distribution changed (effective):', distributionChanged)

    const paymentStatus = paidAmount.greaterThanOrEqualTo(expectedAmount)
      ? 'COMPLETE'
      : 'PARTIAL'

    return this.prisma.$transaction(async (tx) => {
      // 1. Obtener cuentas del agente (EMPLOYEE_CASH_FUND y BANK)
      const agent = await tx.employee.findUnique({
        where: { id: existingRecord.agent },
        include: {
          routes: {
            include: {
              accounts: {
                where: {
                  type: { in: ['EMPLOYEE_CASH_FUND', 'BANK'] }
                }
              }
            }
          }
        }
      })

      const agentAccounts = agent?.routes?.flatMap(r => r.accounts) || []
      const cashAccount = agentAccounts.find(a => a.type === 'EMPLOYEE_CASH_FUND')
      const bankAccount = agentAccounts.find(a => a.type === 'BANK')
      const routeId = agent?.routes?.[0]?.id

      // 2. Calcular el delta basándose SOLO en los pagos que se modifican
      // Solo contamos los pagos que vienen en el input, no todos los del record

      // Crear mapa de pagos existentes para búsqueda rápida
      const existingPaymentsMap = new Map(
        existingRecord.payments.map(p => [p.id, p])
      )

      // oldCashChange = efecto de los pagos QUE SE VAN A MODIFICAR (valores anteriores)
      // newCashChange = efecto NUEVO de esos pagos (valores nuevos)
      let oldCashChange = new Decimal(0)
      let oldBankChange = new Decimal(0)

      // 3. Acumuladores para los nuevos cambios
      let newCashChange = new Decimal(0)
      let newBankChange = new Decimal(0)

      // Track de IDs de pagos procesados en el input
      const processedPaymentIds = new Set<string>()

      // Primero, calcular oldCashChange SOLO de los pagos que vienen en el input
      console.log('[PaymentService] ====== BALANCE CALCULATION START ======')
      console.log('[PaymentService] LeadPaymentReceived ID:', id)
      console.log('[PaymentService] Total payments in input:', input.payments?.length || 0)
      console.log('[PaymentService] Existing payments in record:', existingRecord.payments.length)
      console.log('[PaymentService] Input bankPaidAmount:', bankPaidAmount.toString())
      console.log('[PaymentService] Existing bankPaidAmount:', existingRecord.bankPaidAmount.toString())

      if (input.payments) {
        for (const paymentInput of input.payments) {
          console.log('[PaymentService] Input payment:', {
            paymentId: paymentInput.paymentId,
            loanId: paymentInput.loanId,
            inputAmount: paymentInput.amount,
            inputComission: paymentInput.comission,
            inputMethod: paymentInput.paymentMethod,
            isDeleted: paymentInput.isDeleted,
          })

          if (paymentInput.paymentId) {
            const existingPayment = existingPaymentsMap.get(paymentInput.paymentId)
            if (existingPayment) {
              const oldAmount = new Decimal(existingPayment.amount.toString())
              const oldComission = new Decimal(existingPayment.comission.toString())
              const wasTransfer = existingPayment.paymentMethod === 'MONEY_TRANSFER'

              console.log('[PaymentService] Existing payment from DB:', {
                paymentId: paymentInput.paymentId,
                dbAmount: oldAmount.toString(),
                dbComission: oldComission.toString(),
                dbMethod: existingPayment.paymentMethod,
              })

              if (wasTransfer) {
                oldBankChange = oldBankChange.plus(oldAmount)
                console.log('[PaymentService]   -> Added to oldBankChange:', oldAmount.toString())
              } else {
                oldCashChange = oldCashChange.plus(oldAmount)
                console.log('[PaymentService]   -> Added to oldCashChange:', oldAmount.toString())
              }
              oldCashChange = oldCashChange.minus(oldComission)
              console.log('[PaymentService]   -> Subtracted commission from oldCashChange:', oldComission.toString())
              console.log('[PaymentService]   -> Current oldCashChange:', oldCashChange.toString())
              console.log('[PaymentService]   -> Current oldBankChange:', oldBankChange.toString())
            } else {
              console.log('[PaymentService] WARNING: Payment ID not found in existingPaymentsMap:', paymentInput.paymentId)
            }
          }
        }
      }

      console.log('[PaymentService] After processing all input payments:')
      console.log('[PaymentService]   oldCashChange (before transfer adj):', oldCashChange.toString())
      console.log('[PaymentService]   oldBankChange (before transfer adj):', oldBankChange.toString())

      // IMPORTANTE: Solo aplicar ajuste de transferencia (cashToBank) SI la distribución cambió.
      // Si solo se editaron comisiones (distributionChanged = false), no tocar la distribución.
      let existingCashToBank = new Decimal(0)

      if (distributionChanged) {
        // Cuando se creó el LeadPaymentReceived, si bankPaidAmount > bankAmountChange,
        // se creó una transacción TRANSFER de efectivo a banco.
        // Debemos considerar ese ajuste en oldCashChange y oldBankChange.
        const existingBankPaidAmount = new Decimal(existingRecord.bankPaidAmount.toString())
        existingCashToBank = existingBankPaidAmount.minus(oldBankChange)

        console.log('[PaymentService] Transfer adjustment calculation (distribution changed):')
        console.log('[PaymentService]   existingBankPaidAmount:', existingBankPaidAmount.toString())
        console.log('[PaymentService]   oldBankChange (from MONEY_TRANSFER payments):', oldBankChange.toString())
        console.log('[PaymentService]   existingCashToBank (efectivo que fue al banco):', existingCashToBank.toString())

        if (existingCashToBank.greaterThan(0)) {
          oldCashChange = oldCashChange.minus(existingCashToBank)
          oldBankChange = oldBankChange.plus(existingCashToBank)
          console.log('[PaymentService]   -> Adjusted oldCashChange:', oldCashChange.toString())
          console.log('[PaymentService]   -> Adjusted oldBankChange:', oldBankChange.toString())
        }
      } else {
        console.log('[PaymentService] Skipping transfer adjustment (distribution NOT changed, commission-only edit)')
      }

      // Procesar cada pago en el input
      if (input.payments) {
        for (const paymentInput of input.payments) {
          const paymentAmount = new Decimal(paymentInput.amount)
          const paymentComission = paymentInput.comission
            ? new Decimal(paymentInput.comission)
            : new Decimal(0)

          if (paymentInput.paymentId) {
            // Pago existente - actualizar o eliminar
            const existingPayment = existingRecord.payments.find(
              (p) => p.id === paymentInput.paymentId
            )

            if (existingPayment) {
              const oldAmount = new Decimal(existingPayment.amount.toString())
              const oldComission = new Decimal(existingPayment.comission.toString())

              // Marcar como procesado
              processedPaymentIds.add(paymentInput.paymentId)

              if (paymentInput.isDeleted) {
                console.log('[PaymentService] DELETING payment:', paymentInput.paymentId)
                console.log('[PaymentService]   -> NOT adding to newCashChange/newBankChange (deleted)')

                // Eliminar el pago
                await tx.transaction.deleteMany({
                  where: { loanPayment: paymentInput.paymentId },
                })

                await tx.loanPayment.delete({
                  where: { id: paymentInput.paymentId },
                })

                // Revertir métricas del préstamo
                const loan = existingPayment.loanRelation
                await tx.loan.update({
                  where: { id: loan.id },
                  data: {
                    totalPaid: { decrement: oldAmount },
                    pendingAmountStored: { increment: oldAmount },
                    comissionAmount: { decrement: oldComission },
                    status: 'ACTIVE',
                    finishedDate: null,
                  },
                })
                // No acumular nada en newCashChange/newBankChange porque el pago se eliminó
              } else {
                // Actualizar el pago
                const amountDiff = paymentAmount.minus(oldAmount)
                const comissionDiff = paymentComission.minus(oldComission)

                await tx.loanPayment.update({
                  where: { id: paymentInput.paymentId },
                  data: {
                    amount: paymentAmount,
                    comission: paymentComission,
                    paymentMethod: paymentInput.paymentMethod,
                  },
                })

                // Actualizar transacciones (incluyendo recálculo de profitAmount)
                const incomeSource = paymentInput.paymentMethod === 'CASH'
                  ? 'CASH_LOAN_PAYMENT'
                  : 'BANK_LOAN_PAYMENT'

                const isTransfer = paymentInput.paymentMethod === 'MONEY_TRANSFER'
                const destinationAccountId = isTransfer ? bankAccount?.id : cashAccount?.id

                // Obtener datos del loan para recalcular profit
                const loan = existingPayment.loanRelation
                const loanTotalProfit = new Decimal(loan.profitAmount.toString())
                const loanTotalDebt = new Decimal(loan.totalDebtAcquired.toString())
                const loanIsBadDebt = !!loan.badDebtDate

                // Recalcular profitAmount y returnToCapital
                const { profitAmount, returnToCapital } = calculatePaymentProfit(
                  paymentAmount,
                  loanTotalProfit,
                  loanTotalDebt,
                  loanIsBadDebt
                )

                await tx.transaction.updateMany({
                  where: {
                    loanPayment: paymentInput.paymentId,
                    type: 'INCOME',
                  },
                  data: {
                    amount: paymentAmount,
                    incomeSource,
                    destinationAccount: destinationAccountId,
                    profitAmount,
                    returnToCapital,
                  },
                })

                // Handle commission transaction
                if (paymentComission.isZero() && !oldComission.isZero()) {
                  // Commission became 0 - DELETE the commission transaction
                  console.log('[PaymentService] Deleting commission transaction (commission became 0)')
                  await tx.transaction.deleteMany({
                    where: {
                      loanPayment: paymentInput.paymentId,
                      type: 'EXPENSE',
                      expenseSource: 'LOAN_PAYMENT_COMISSION',
                    },
                  })
                } else if (!comissionDiff.isZero()) {
                  // Commission changed but is not 0 - update it
                  if (oldComission.isZero() && paymentComission.greaterThan(0)) {
                    // Commission was 0 and now has a value - create new transaction
                    console.log('[PaymentService] Creating new commission transaction')
                    if (cashAccount) {
                      await this.transactionRepository.create(
                        {
                          amount: paymentComission,
                          date: new Date(),
                          type: 'EXPENSE',
                          expenseSource: 'LOAN_PAYMENT_COMISSION',
                          sourceAccountId: cashAccount.id,
                          loanPaymentId: paymentInput.paymentId,
                          leadId: existingRecord.lead,
                          routeId,
                        },
                        tx
                      )
                    }
                  } else {
                    // Just update the existing commission transaction
                    console.log('[PaymentService] Updating commission transaction to:', paymentComission.toString())
                    await tx.transaction.updateMany({
                      where: {
                        loanPayment: paymentInput.paymentId,
                        type: 'EXPENSE',
                        expenseSource: 'LOAN_PAYMENT_COMISSION',
                      },
                      data: {
                        amount: paymentComission,
                      },
                    })
                  }
                }

                // Actualizar métricas del préstamo si cambió el monto
                if (!amountDiff.isZero() || !comissionDiff.isZero()) {
                  const loan = existingPayment.loanRelation
                  await tx.loan.update({
                    where: { id: loan.id },
                    data: {
                      totalPaid: { increment: amountDiff },
                      pendingAmountStored: { decrement: amountDiff },
                      comissionAmount: { increment: comissionDiff },
                    },
                  })
                }

                // Acumular nuevos cambios
                console.log('[PaymentService] UPDATING payment:', paymentInput.paymentId)
                if (isTransfer) {
                  newBankChange = newBankChange.plus(paymentAmount)
                  console.log('[PaymentService]   -> Added to newBankChange:', paymentAmount.toString())
                } else {
                  newCashChange = newCashChange.plus(paymentAmount)
                  console.log('[PaymentService]   -> Added to newCashChange:', paymentAmount.toString())
                }
                // Comisión siempre afecta efectivo
                newCashChange = newCashChange.minus(paymentComission)
                console.log('[PaymentService]   -> Subtracted commission from newCashChange:', paymentComission.toString())
                console.log('[PaymentService]   -> Current newCashChange:', newCashChange.toString())
                console.log('[PaymentService]   -> Current newBankChange:', newBankChange.toString())
              }
            }
          } else if (!paymentInput.isDeleted && paymentAmount.greaterThan(0)) {
            // Nuevo pago - crear
            const loan = await this.loanRepository.findById(paymentInput.loanId)
            if (!loan) continue

            // Recalculate commission using loantype's default if not provided
            const actualCommission = paymentInput.comission !== undefined
              ? new Decimal(paymentInput.comission)
              : loan.loantypeRelation?.loanPaymentComission
                ? new Decimal(loan.loantypeRelation.loanPaymentComission.toString())
                : new Decimal(0)

            const isTransfer = paymentInput.paymentMethod === 'MONEY_TRANSFER'
            const destinationAccountId = isTransfer ? bankAccount?.id : cashAccount?.id

            // Calcular profit del pago
            const totalProfit = new Decimal(loan.profitAmount.toString())
            const totalDebt = new Decimal(loan.totalDebtAcquired.toString())
            const isBadDebt = !!loan.badDebtDate

            const { profitAmount, returnToCapital } = calculatePaymentProfit(
              paymentAmount,
              totalProfit,
              totalDebt,
              isBadDebt
            )

            const payment = await this.paymentRepository.create(
              {
                amount: paymentAmount,
                comission: actualCommission,
                receivedAt: new Date(),
                paymentMethod: paymentInput.paymentMethod,
                type: 'PAYMENT',
                loan: paymentInput.loanId,
                leadPaymentReceived: id,
              },
              tx
            )

            // Crear transacción INCOME
            if (destinationAccountId) {
              await this.transactionRepository.create(
                {
                  amount: paymentAmount,
                  date: new Date(),
                  type: 'INCOME',
                  incomeSource: isTransfer ? 'BANK_LOAN_PAYMENT' : 'CASH_LOAN_PAYMENT',
                  profitAmount,
                  returnToCapital,
                  destinationAccountId,
                  loanId: loan.id,
                  loanPaymentId: payment.id,
                  leadId: existingRecord.lead,
                  routeId,
                  leadPaymentReceivedId: id,
                },
                tx
              )
            }

            // Crear transacción EXPENSE por comisión si aplica
            if (actualCommission.greaterThan(0) && cashAccount) {
              await this.transactionRepository.create(
                {
                  amount: actualCommission,
                  date: new Date(),
                  type: 'EXPENSE',
                  expenseSource: 'LOAN_PAYMENT_COMISSION',
                  sourceAccountId: cashAccount.id,
                  loanPaymentId: payment.id,
                  leadId: existingRecord.lead,
                  routeId,
                },
                tx
              )
            }

            // Acumular nuevos cambios
            console.log('[PaymentService] CREATING new payment for loan:', paymentInput.loanId)
            if (isTransfer) {
              newBankChange = newBankChange.plus(paymentAmount)
              console.log('[PaymentService]   -> Added to newBankChange:', paymentAmount.toString())
            } else {
              newCashChange = newCashChange.plus(paymentAmount)
              console.log('[PaymentService]   -> Added to newCashChange:', paymentAmount.toString())
            }
            newCashChange = newCashChange.minus(actualCommission)
            console.log('[PaymentService]   -> Subtracted commission from newCashChange:', actualCommission.toString())
            console.log('[PaymentService]   -> Current newCashChange:', newCashChange.toString())
            console.log('[PaymentService]   -> Current newBankChange:', newBankChange.toString())

            // Actualizar métricas del préstamo
            const currentTotalPaid = new Decimal(loan.totalPaid.toString())
            const currentPending = new Decimal(loan.pendingAmountStored.toString())
            const updatedPending = currentPending.minus(paymentAmount)

            await tx.loan.update({
              where: { id: loan.id },
              data: {
                totalPaid: currentTotalPaid.plus(paymentAmount),
                pendingAmountStored: updatedPending.isNegative() ? new Decimal(0) : updatedPending,
                comissionAmount: { increment: actualCommission },
                ...(updatedPending.lessThanOrEqualTo(0) && {
                  status: 'FINISHED',
                  finishedDate: new Date(),
                }),
              },
            })
          }
        }
      }

      console.log('[PaymentService] After processing all payments:')
      console.log('[PaymentService]   newCashChange (before transfer adj):', newCashChange.toString())
      console.log('[PaymentService]   newBankChange (before transfer adj):', newBankChange.toString())

      // Solo aplicar ajuste de transferencia si la distribución cambió
      let newCashToBank = new Decimal(0)

      if (distributionChanged) {
        // Verificar si quedan pagos después de las eliminaciones (para determinar newBankPaidAmount)
        const remainingPaymentsForCalc = await tx.loanPayment.count({
          where: { leadPaymentReceived: id },
        })

        // El nuevo bankPaidAmount viene del input (distribución del modal).
        // Si no hay pagos restantes, bankPaidAmount debe ser 0.
        // Si hay pagos y el input no especifica bankPaidAmount, mantener el existente.
        const newBankPaidAmount = remainingPaymentsForCalc === 0
          ? new Decimal(0)
          : bankPaidAmount  // bankPaidAmount ya viene del input o del existingRecord

        console.log('[PaymentService] New transfer adjustment calculation (distribution changed):')
        console.log('[PaymentService]   newBankChange (from MONEY_TRANSFER payments):', newBankChange.toString())
        console.log('[PaymentService]   newBankPaidAmount (from input/distribution):', newBankPaidAmount.toString())
        console.log('[PaymentService]   remainingPayments:', remainingPaymentsForCalc)

        // Ajustar newCashChange y newBankChange si hay transferencia de efectivo a banco
        newCashToBank = newBankPaidAmount.minus(newBankChange)
        console.log('[PaymentService]   newCashToBank (efectivo que irá al banco):', newCashToBank.toString())

        if (newCashToBank.greaterThan(0)) {
          newCashChange = newCashChange.minus(newCashToBank)
          newBankChange = newBankChange.plus(newCashToBank)
          console.log('[PaymentService]   -> Adjusted newCashChange:', newCashChange.toString())
          console.log('[PaymentService]   -> Adjusted newBankChange:', newBankChange.toString())
        }

        // Manejar la transacción TRANSFER según los cambios en cashToBank
        // Always check for existing TRANSFER first to prevent duplicates
        console.log('[PaymentService] Handling TRANSFER transaction:')
        console.log('[PaymentService]   existingCashToBank:', existingCashToBank.toString())
        console.log('[PaymentService]   newCashToBank:', newCashToBank.toString())

        // Buscar transacción TRANSFER existente
        const existingTransferTx = await tx.transaction.findFirst({
          where: {
            leadPaymentReceived: id,
            type: 'TRANSFER',
          },
        })

        console.log('[PaymentService]   Existing TRANSFER:', existingTransferTx?.id || 'none',
          existingTransferTx ? `amount: ${existingTransferTx.amount}` : '')

        if (newCashToBank.isZero()) {
          // No transfer needed - delete if exists
          if (existingTransferTx) {
            console.log('[PaymentService]   -> Deleting TRANSFER transaction (no longer needed)')
            await tx.transaction.delete({
              where: { id: existingTransferTx.id },
            })
          }
        } else if (existingTransferTx) {
          // TRANSFER exists - update it with new amount if different
          if (!new Decimal(existingTransferTx.amount.toString()).equals(newCashToBank)) {
            console.log('[PaymentService]   -> Updating TRANSFER transaction:', newCashToBank.toString())
            await tx.transaction.update({
              where: { id: existingTransferTx.id },
              data: { amount: newCashToBank },
            })
          } else {
            console.log('[PaymentService]   -> TRANSFER amount unchanged, skipping update')
          }
        } else if (cashAccount && bankAccount) {
          // No TRANSFER exists and we need one - create it
          console.log('[PaymentService]   -> Creating new TRANSFER transaction:', newCashToBank.toString())
          await this.transactionRepository.create(
            {
              amount: newCashToBank,
              date: existingRecord.createdAt, // Use the original LeadPaymentReceived date
              type: 'TRANSFER',
              sourceAccountId: cashAccount.id,
              destinationAccountId: bankAccount.id,
              leadId: existingRecord.lead,
              routeId,
              leadPaymentReceivedId: id,
            },
            tx
          )
        }
      } else {
        console.log('[PaymentService] Skipping new transfer adjustment (distribution NOT changed)')
      }

      // 5. Calcular y aplicar cambios netos de balance
      console.log('[PaymentService] ====== FINAL BALANCE CALCULATION ======')
      console.log('[PaymentService] Cash and bank changes calculated from payment methods:')
      console.log('[PaymentService]   oldCashChange:', oldCashChange.toString())
      console.log('[PaymentService]   oldBankChange:', oldBankChange.toString())
      console.log('[PaymentService]   newCashChange:', newCashChange.toString())
      console.log('[PaymentService]   newBankChange:', newBankChange.toString())

      const netCashChange = newCashChange.minus(oldCashChange)
      const netBankChange = newBankChange.minus(oldBankChange)

      console.log('[PaymentService] NET CHANGE CALCULATION:')
      console.log('[PaymentService]   netCashChange = newCashChange - oldCashChange')
      console.log('[PaymentService]   netCashChange = ' + newCashChange.toString() + ' - ' + oldCashChange.toString() + ' = ' + netCashChange.toString())
      console.log('[PaymentService]   netBankChange = newBankChange - oldBankChange')
      console.log('[PaymentService]   netBankChange = ' + newBankChange.toString() + ' - ' + oldBankChange.toString() + ' = ' + netBankChange.toString())
      console.log('[PaymentService] EXPECTED: If deleting all payments, netCashChange should be NEGATIVE')

      // Log balance BEFORE adjustment
      const cashBalanceBefore = cashAccount ? await tx.account.findUnique({ where: { id: cashAccount.id } }) : null
      const bankBalanceBefore = bankAccount ? await tx.account.findUnique({ where: { id: bankAccount.id } }) : null
      console.log('[PaymentService] Balances BEFORE adjustment:')
      console.log('[PaymentService]   Cash account:', {
        id: cashAccount?.id,
        type: cashAccount?.type,
        amount: cashBalanceBefore?.amount?.toString(),
      })
      console.log('[PaymentService]   Bank account:', {
        id: bankAccount?.id,
        type: bankAccount?.type,
        amount: bankBalanceBefore?.amount?.toString(),
      })

      if (cashAccount && !netCashChange.isZero()) {
        console.log('[PaymentService] Applying netCashChange to cash account:', netCashChange.toString())
        console.log('[PaymentService]   Formula: ' + cashBalanceBefore?.amount?.toString() + ' + (' + netCashChange.toString() + ')')
        await this.accountRepository.addToBalance(cashAccount.id, netCashChange, tx)
      } else {
        console.log('[PaymentService] No cash balance change needed (netCashChange is zero)')
      }

      if (bankAccount && !netBankChange.isZero()) {
        console.log('[PaymentService] Applying netBankChange to bank account:', netBankChange.toString())
        console.log('[PaymentService]   Formula: ' + bankBalanceBefore?.amount?.toString() + ' + (' + netBankChange.toString() + ')')
        await this.accountRepository.addToBalance(bankAccount.id, netBankChange, tx)
      } else {
        console.log('[PaymentService] No bank balance change needed (netBankChange is zero)')
      }

      // Log balance AFTER adjustment
      const cashBalanceAfter = cashAccount ? await tx.account.findUnique({ where: { id: cashAccount.id } }) : null
      const bankBalanceAfter = bankAccount ? await tx.account.findUnique({ where: { id: bankAccount.id } }) : null
      console.log('[PaymentService] Balances AFTER adjustment:')
      console.log('[PaymentService]   Cash: ' + cashBalanceBefore?.amount?.toString() + ' → ' + cashBalanceAfter?.amount?.toString())
      console.log('[PaymentService]   Bank: ' + bankBalanceBefore?.amount?.toString() + ' → ' + bankBalanceAfter?.amount?.toString())

      // Verificar si quedan pagos después de las eliminaciones
      const remainingPayments = await tx.loanPayment.count({
        where: { leadPaymentReceived: id },
      })

      console.log('[PaymentService] ====== SUMMARY ======')
      console.log('[PaymentService] Remaining payments after operation:', remainingPayments)
      console.log('[PaymentService] Final netCashChange applied:', netCashChange.toString())
      console.log('[PaymentService] Final netBankChange applied:', netBankChange.toString())
      console.log('[PaymentService] Cash balance changed from', cashBalanceBefore?.amount?.toString(), 'to', cashBalanceAfter?.amount?.toString())
      console.log('[PaymentService] ====== END BALANCE CALCULATION ======')

      // Si no quedan pagos, eliminar el LeadPaymentReceived y transacciones restantes
      if (remainingPayments === 0) {
        console.log('[PaymentService] No remaining payments, deleting LeadPaymentReceived and related transactions')

        // Eliminar cualquier transacción restante vinculada al LeadPaymentReceived
        await tx.transaction.deleteMany({
          where: { leadPaymentReceived: id },
        })

        // Eliminar el LeadPaymentReceived
        await tx.leadPaymentReceived.delete({
          where: { id },
        })

        return null // Indicar que fue eliminado
      }

      // Obtener pagos actuales después de la actualización para calcular montos reales
      const allCurrentPayments = await tx.loanPayment.findMany({
        where: { leadPaymentReceived: id },
      })

      // Calcular montos base desde los métodos de pago actuales
      let rawCashFromPayments = new Decimal(0)
      let rawBankFromPayments = new Decimal(0)

      for (const payment of allCurrentPayments) {
        if (payment.paymentMethod === 'MONEY_TRANSFER') {
          rawBankFromPayments = rawBankFromPayments.plus(new Decimal(payment.amount.toString()))
        } else {
          rawCashFromPayments = rawCashFromPayments.plus(new Decimal(payment.amount.toString()))
        }
      }

      // IMPORTANTE: cashPaidAmount y bankPaidAmount deben incluir el efecto del cashToBank (TRANSFER)
      // Si distributionChanged, usamos los valores del input (que ya incluyen cashToBank)
      // Si no, calculamos basándonos en el cashToBank actual
      let finalCashPaid: Decimal
      let finalBankPaid: Decimal

      if (distributionChanged) {
        // Usar los valores del input (ya tienen cashToBank aplicado)
        finalCashPaid = cashPaidAmount
        finalBankPaid = bankPaidAmount
      } else {
        // Sin cambio de distribución, mantener los valores existentes
        finalCashPaid = new Decimal(existingRecord.cashPaidAmount.toString())
        finalBankPaid = new Decimal(existingRecord.bankPaidAmount.toString())
      }

      console.log('[PaymentService] Final paid amounts (including cashToBank effect):')
      console.log('[PaymentService]   rawCashFromPayments:', rawCashFromPayments.toString())
      console.log('[PaymentService]   rawBankFromPayments:', rawBankFromPayments.toString())
      console.log('[PaymentService]   finalCashPaid:', finalCashPaid.toString())
      console.log('[PaymentService]   finalBankPaid:', finalBankPaid.toString())
      console.log('[PaymentService]   distributionChanged:', distributionChanged)

      // Actualizar el registro LeadPaymentReceived
      return this.paymentRepository.updateLeadPaymentReceived(
        id,
        {
          expectedAmount,
          paidAmount,
          cashPaidAmount: finalCashPaid,
          bankPaidAmount: finalBankPaid,
          falcoAmount,
          paymentStatus,
        },
        tx
      )
    })
  }

  async createFalcoCompensatoryPayment(input: {
    leadPaymentReceivedId: string
    amount: string
  }) {
    const compensationAmount = new Decimal(input.amount)

    if (compensationAmount.lessThanOrEqualTo(0)) {
      throw new GraphQLError('Compensation amount must be positive', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    // Get the LeadPaymentReceived record
    const leadPaymentReceived = await this.prisma.leadPaymentReceived.findUnique({
      where: { id: input.leadPaymentReceivedId },
      include: {
        falcoCompensatoryPayments: true,
        leadRelation: {
          include: {
            routes: {
              include: {
                accounts: {
                  where: { type: 'EMPLOYEE_CASH_FUND' },
                },
              },
            },
          },
        },
      },
    })

    if (!leadPaymentReceived) {
      throw new GraphQLError('LeadPaymentReceived not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Calculate total already compensated
    const totalCompensated = leadPaymentReceived.falcoCompensatoryPayments.reduce(
      (sum, payment) => sum.plus(new Decimal(payment.amount.toString())),
      new Decimal(0)
    )

    const originalFalcoAmount = new Decimal(leadPaymentReceived.falcoAmount.toString())
    const remainingFalco = originalFalcoAmount.minus(totalCompensated)

    // Validate that compensation doesn't exceed remaining falco
    if (compensationAmount.greaterThan(remainingFalco)) {
      throw new GraphQLError(
        `Compensation amount (${compensationAmount}) exceeds remaining falco (${remainingFalco})`,
        { extensions: { code: 'BAD_USER_INPUT' } }
      )
    }

    // Get the cash account for the lead
    const cashAccount = leadPaymentReceived.leadRelation?.routes?.[0]?.accounts?.[0]
    const routeId = leadPaymentReceived.leadRelation?.routes?.[0]?.id

    return this.prisma.$transaction(async (tx) => {
      // 1. Create the FalcoCompensatoryPayment record
      const falcoCompensatoryPayment = await tx.falcoCompensatoryPayment.create({
        data: {
          amount: compensationAmount,
          leadPaymentReceived: input.leadPaymentReceivedId,
        },
      })

      // 2. Find and update the FALCO_LOSS transaction
      const falcoLossTransaction = await tx.transaction.findFirst({
        where: {
          leadPaymentReceived: input.leadPaymentReceivedId,
          type: 'EXPENSE',
          expenseSource: 'FALCO_LOSS',
        },
      })

      if (falcoLossTransaction) {
        const newCompensatedTotal = totalCompensated.plus(compensationAmount)
        const newLossAmount = originalFalcoAmount.minus(newCompensatedTotal)

        // Update the transaction amount and description
        const isFullyCompensated = newLossAmount.lessThanOrEqualTo(0)

        await tx.transaction.update({
          where: { id: falcoLossTransaction.id },
          data: {
            amount: isFullyCompensated ? new Decimal(0) : newLossAmount,
            description: isFullyCompensated
              ? `Pérdida por falco - COMPLETAMENTE COMPENSADO`
              : `Pérdida por falco - PARCIALMENTE COMPENSADO (${newCompensatedTotal} de ${originalFalcoAmount})`,
          },
        })
      }

      // 3. Return money to the cash account (compensated amount)
      if (cashAccount) {
        await this.accountRepository.addToBalance(cashAccount.id, compensationAmount, tx)
      }

      // 4. Create an INCOME transaction for the compensation
      if (cashAccount && routeId) {
        await this.transactionRepository.create(
          {
            amount: compensationAmount,
            date: new Date(),
            type: 'INCOME',
            incomeSource: 'FALCO_COMPENSATORY',
            description: `Compensación de falco - ${input.leadPaymentReceivedId}`,
            sourceAccountId: cashAccount.id,
            leadId: leadPaymentReceived.lead,
            routeId,
            leadPaymentReceivedId: input.leadPaymentReceivedId,
          },
          tx
        )
      }

      return falcoCompensatoryPayment
    })
  }
}
