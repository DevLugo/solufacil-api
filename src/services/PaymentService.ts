import { GraphQLError } from 'graphql'
import { Decimal } from 'decimal.js'
import type { PrismaClient, PaymentMethod } from '@solufacil/database'
import { PaymentRepository } from '../repositories/PaymentRepository'
import { LoanRepository } from '../repositories/LoanRepository'
import { AccountRepository } from '../repositories/AccountRepository'
import { BalanceService } from './BalanceService'
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
  private accountRepository: AccountRepository
  private balanceService: BalanceService

  constructor(private prisma: PrismaClient) {
    this.paymentRepository = new PaymentRepository(prisma)
    this.loanRepository = new LoanRepository(prisma)
    this.accountRepository = new AccountRepository(prisma)
    this.balanceService = new BalanceService(prisma)
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

      // Crear AccountEntry para el pago (CREDIT)
      const balanceService = new BalanceService(tx as any)
      const sourceType = input.paymentMethod === 'CASH'
        ? 'LOAN_PAYMENT_CASH'
        : 'LOAN_PAYMENT_BANK'

      await balanceService.createEntry({
        accountId: leadAccount.id,
        entryType: 'CREDIT',
        amount: paymentAmount,
        sourceType: sourceType as any,
        loanId: loan.id,
        loanPaymentId: payment.id,
        snapshotLeadId: loan.lead || undefined,
        snapshotRouteId: loan.snapshotRouteId || undefined,
        profitAmount,
        returnToCapital,
        entryDate: input.receivedAt,
      })

      // Crear AccountEntry para la comisión si aplica (DEBIT)
      if (comission.greaterThan(0)) {
        await balanceService.createEntry({
          accountId: leadAccount.id,
          entryType: 'DEBIT',
          amount: comission,
          sourceType: 'PAYMENT_COMMISSION',
          loanPaymentId: payment.id,
          snapshotLeadId: loan.lead || undefined,
          snapshotRouteId: loan.snapshotRouteId || undefined,
          entryDate: input.receivedAt,
        })
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
      const balanceService = new BalanceService(tx as any)

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

      // Obtener routeId para los entries
      const routeId = agent?.routes?.[0]?.id || ''

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

      // Track bank payments that came via MONEY_TRANSFER (direct bank deposits)
      let directBankPayments = new Decimal(0)

      // 3. Crear los pagos individuales y sus entries en el ledger
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

        // CREDIT: Pago recibido (suma a la cuenta)
        if (destinationAccountId) {
          await balanceService.createEntry({
            accountId: destinationAccountId,
            entryType: 'CREDIT',
            amount: paymentAmount,
            sourceType: isTransfer ? 'LOAN_PAYMENT_BANK' : 'LOAN_PAYMENT_CASH',
            entryDate: paymentDate,
            loanId: loan.id,
            loanPaymentId: payment.id,
            leadPaymentReceivedId: leadPaymentReceived.id,
            profitAmount,
            returnToCapital,
            snapshotLeadId: input.leadId,
            snapshotRouteId: routeId,
          }, tx)
        }

        // Track direct bank payments for cashToBank calculation
        if (isTransfer) {
          directBankPayments = directBankPayments.plus(paymentAmount)
        }

        // DEBIT: Comisión (resta de efectivo)
        if (comissionAmount.greaterThan(0) && cashAccount) {
          await balanceService.createEntry({
            accountId: cashAccount.id,
            entryType: 'DEBIT',
            amount: comissionAmount,
            sourceType: 'PAYMENT_COMMISSION',
            entryDate: paymentDate,
            loanPaymentId: payment.id,
            leadPaymentReceivedId: leadPaymentReceived.id,
            snapshotLeadId: input.leadId,
            snapshotRouteId: routeId,
          }, tx)
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

      // 4. Calcular si el líder depositó efectivo al banco
      // bankPaidAmount = total que terminó en banco
      // directBankPayments = pagos que fueron directo por MONEY_TRANSFER
      // La diferencia = efectivo que el líder depositó al banco
      const cashToBank = bankPaidAmount.minus(directBankPayments)

      if (cashToBank.greaterThan(0) && cashAccount && bankAccount) {
        // TRANSFER: Efectivo depositado al banco
        await balanceService.createTransfer({
          sourceAccountId: cashAccount.id,
          destinationAccountId: bankAccount.id,
          amount: cashToBank,
          entryDate: paymentDate,
          description: `Depósito efectivo a banco - LPR ${leadPaymentReceived.id}`,
          snapshotLeadId: input.leadId,
          snapshotRouteId: routeId,
          leadPaymentReceivedId: leadPaymentReceived.id,
        }, tx)
      }

      // 5. Si hay falco, crear DEBIT por pérdida
      if (falcoAmount.greaterThan(0) && cashAccount) {
        await balanceService.createEntry({
          accountId: cashAccount.id,
          entryType: 'DEBIT',
          amount: falcoAmount,
          sourceType: 'FALCO_LOSS',
          entryDate: paymentDate,
          description: `Pérdida por falco - LPR ${leadPaymentReceived.id}`,
          leadPaymentReceivedId: leadPaymentReceived.id,
          snapshotLeadId: input.leadId,
          snapshotRouteId: routeId,
        }, tx)
      }

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

      // Note: AccountEntry records are managed by BalanceService through updateLeadPaymentReceived

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
      // Eliminar AccountEntry records asociados
      await tx.accountEntry.deleteMany({
        where: { loanPaymentId: id },
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
    // Get the existing LeadPaymentReceived
    const existingRecord = await this.paymentRepository.findLeadPaymentReceivedById(id)
    if (!existingRecord) {
      throw new GraphQLError('LeadPaymentReceived not found', {
        extensions: { code: 'NOT_FOUND' },
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

    const paymentStatus = paidAmount.greaterThanOrEqualTo(expectedAmount)
      ? 'COMPLETE'
      : 'PARTIAL'

    return this.prisma.$transaction(async (tx) => {
      const balanceService = new BalanceService(tx as any)

      // 1. Get agent accounts
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
      const routeId = agent?.routes?.[0]?.id || ''

      // 2. Delete all existing AccountEntry for this LPR (this reverses all balance changes)
      await balanceService.deleteEntriesByLeadPaymentReceived(id, tx)

      // 3. Process payments: delete/update/create LoanPayment records
      const existingPaymentsMap = new Map(
        existingRecord.payments.map(p => [p.id, p])
      )

      // Track bank payments that came via MONEY_TRANSFER (for cashToBank calculation)
      let directBankPayments = new Decimal(0)

      if (input.payments) {
        for (const paymentInput of input.payments) {
          const paymentAmount = new Decimal(paymentInput.amount)

          if (paymentInput.paymentId) {
            // Existing payment
            const existingPayment = existingPaymentsMap.get(paymentInput.paymentId)

            if (existingPayment) {
              const oldAmount = new Decimal(existingPayment.amount.toString())
              const oldComission = new Decimal(existingPayment.comission.toString())

              if (paymentInput.isDeleted) {
                // Delete the payment
                await tx.loanPayment.delete({
                  where: { id: paymentInput.paymentId },
                })

                // Revert loan metrics
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
              } else {
                // Update the payment
                const paymentComission = paymentInput.comission !== undefined
                  ? new Decimal(paymentInput.comission)
                  : new Decimal(0)

                await tx.loanPayment.update({
                  where: { id: paymentInput.paymentId },
                  data: {
                    amount: paymentAmount,
                    comission: paymentComission,
                    paymentMethod: paymentInput.paymentMethod,
                  },
                })

                // Update loan metrics if changed
                const amountDiff = paymentAmount.minus(oldAmount)
                const comissionDiff = paymentComission.minus(oldComission)

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
              }
            }
          } else if (!paymentInput.isDeleted && paymentAmount.greaterThan(0)) {
            // New payment - create
            const loan = await this.loanRepository.findById(paymentInput.loanId)
            if (!loan) continue

            const actualCommission = paymentInput.comission !== undefined
              ? new Decimal(paymentInput.comission)
              : loan.loantypeRelation?.loanPaymentComission
                ? new Decimal(loan.loantypeRelation.loanPaymentComission.toString())
                : new Decimal(0)

            await this.paymentRepository.create(
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

            // Update loan metrics
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

      // 5. Check if any payments remain
      const remainingPayments = await tx.loanPayment.findMany({
        where: { leadPaymentReceived: id },
        include: { loanRelation: true },
      })

      if (remainingPayments.length === 0) {
        // Delete the LeadPaymentReceived
        await tx.leadPaymentReceived.delete({
          where: { id },
        })
        return null
      }

      // 6. Recreate AccountEntry for all remaining payments
      for (const payment of remainingPayments) {
        const loan = payment.loanRelation
        const paymentAmount = new Decimal(payment.amount.toString())
        const comissionAmount = new Decimal(payment.comission.toString())

        const totalProfit = new Decimal(loan.profitAmount.toString())
        const totalDebt = new Decimal(loan.totalDebtAcquired.toString())
        const isBadDebt = !!loan.badDebtDate

        const { profitAmount, returnToCapital } = calculatePaymentProfit(
          paymentAmount,
          totalProfit,
          totalDebt,
          isBadDebt
        )

        const isTransfer = payment.paymentMethod === 'MONEY_TRANSFER'
        const destinationAccountId = isTransfer ? bankAccount?.id : cashAccount?.id

        // CREDIT: Payment received
        if (destinationAccountId) {
          await balanceService.createEntry({
            accountId: destinationAccountId,
            entryType: 'CREDIT',
            amount: paymentAmount,
            sourceType: isTransfer ? 'LOAN_PAYMENT_BANK' : 'LOAN_PAYMENT_CASH',
            entryDate: payment.receivedAt,
            loanId: loan.id,
            loanPaymentId: payment.id,
            leadPaymentReceivedId: id,
            profitAmount,
            returnToCapital,
            snapshotLeadId: existingRecord.lead,
            snapshotRouteId: routeId,
          }, tx)
        }

        // Track direct bank payments for cashToBank calculation
        if (isTransfer) {
          directBankPayments = directBankPayments.plus(paymentAmount)
        }

        // DEBIT: Commission
        if (comissionAmount.greaterThan(0) && cashAccount) {
          await balanceService.createEntry({
            accountId: cashAccount.id,
            entryType: 'DEBIT',
            amount: comissionAmount,
            sourceType: 'PAYMENT_COMMISSION',
            entryDate: payment.receivedAt,
            loanPaymentId: payment.id,
            leadPaymentReceivedId: id,
            snapshotLeadId: existingRecord.lead,
            snapshotRouteId: routeId,
          }, tx)
        }
      }

      // 7. Handle cash-to-bank transfer
      const cashToBank = bankPaidAmount.minus(directBankPayments)

      if (cashToBank.greaterThan(0) && cashAccount && bankAccount) {
        await balanceService.createTransfer({
          sourceAccountId: cashAccount.id,
          destinationAccountId: bankAccount.id,
          amount: cashToBank,
          entryDate: existingRecord.createdAt,
          description: `Depósito efectivo a banco - LPR ${id}`,
          snapshotLeadId: existingRecord.lead,
          snapshotRouteId: routeId,
          leadPaymentReceivedId: id,
        }, tx)
      }

      // 8. Handle falco
      if (falcoAmount.greaterThan(0) && cashAccount) {
        await balanceService.createEntry({
          accountId: cashAccount.id,
          entryType: 'DEBIT',
          amount: falcoAmount,
          sourceType: 'FALCO_LOSS',
          entryDate: existingRecord.createdAt,
          description: `Pérdida por falco - LPR ${id}`,
          leadPaymentReceivedId: id,
          snapshotLeadId: existingRecord.lead,
          snapshotRouteId: routeId,
        }, tx)
      }

      // 9. Update the LeadPaymentReceived record
      return this.paymentRepository.updateLeadPaymentReceived(
        id,
        {
          expectedAmount,
          paidAmount,
          cashPaidAmount,
          bankPaidAmount,
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
    const routeId = leadPaymentReceived.leadRelation?.routes?.[0]?.id || ''

    return this.prisma.$transaction(async (tx) => {
      const balanceService = new BalanceService(tx as any)

      // 1. Create the FalcoCompensatoryPayment record
      const falcoCompensatoryPayment = await tx.falcoCompensatoryPayment.create({
        data: {
          amount: compensationAmount,
          leadPaymentReceived: input.leadPaymentReceivedId,
        },
      })

      // 2. CREDIT: Return money to the cash account (compensated amount)
      if (cashAccount) {
        const newCompensatedTotal = totalCompensated.plus(compensationAmount)
        const isFullyCompensated = originalFalcoAmount.minus(newCompensatedTotal).lessThanOrEqualTo(0)

        await balanceService.createEntry({
          accountId: cashAccount.id,
          entryType: 'CREDIT',
          amount: compensationAmount,
          sourceType: 'FALCO_COMPENSATORY',
          description: isFullyCompensated
            ? `Compensación de falco - COMPLETA - LPR ${input.leadPaymentReceivedId}`
            : `Compensación de falco (${newCompensatedTotal} de ${originalFalcoAmount}) - LPR ${input.leadPaymentReceivedId}`,
          leadPaymentReceivedId: input.leadPaymentReceivedId,
          snapshotLeadId: leadPaymentReceived.lead,
          snapshotRouteId: routeId,
        }, tx)
      }

      return falcoCompensatoryPayment
    })
  }
}
