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
    const comission = input.comission ? new Decimal(input.comission) : new Decimal(0)

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

      // 4. Crear los pagos individuales y transacciones
      for (const paymentInput of input.payments) {
        const loan = await this.loanRepository.findById(paymentInput.loanId)
        if (!loan) continue

        const paymentAmount = new Decimal(paymentInput.amount)
        const comissionAmount = paymentInput.comission ? new Decimal(paymentInput.comission) : new Decimal(0)

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
        if (isTransfer) {
          bankAmountChange = bankAmountChange.plus(paymentAmount)
        } else {
          cashAmountChange = cashAmountChange.plus(paymentAmount)
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

      // 5. Si hay transferencia de efectivo a banco (bankPaidAmount del modal)
      if (bankPaidAmount.greaterThan(0) && cashAccount && bankAccount) {
        await this.transactionRepository.create(
          {
            amount: bankPaidAmount,
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
        cashAmountChange = cashAmountChange.minus(bankPaidAmount)
        bankAmountChange = bankAmountChange.plus(bankPaidAmount)
      }

      // 6. Actualizar balances de cuentas con los montos acumulados
      if (cashAccount && !cashAmountChange.isZero()) {
        await this.accountRepository.addToBalance(cashAccount.id, cashAmountChange, tx)
      }

      if (bankAccount && !bankAmountChange.isZero()) {
        await this.accountRepository.addToBalance(bankAccount.id, bankAmountChange, tx)
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
    // Obtener el LeadPaymentReceived existente
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
      if (input.payments) {
        for (const paymentInput of input.payments) {
          if (paymentInput.paymentId) {
            const existingPayment = existingPaymentsMap.get(paymentInput.paymentId)
            if (existingPayment) {
              const oldAmount = new Decimal(existingPayment.amount.toString())
              const oldComission = new Decimal(existingPayment.comission.toString())
              const wasTransfer = existingPayment.paymentMethod === 'MONEY_TRANSFER'

              if (wasTransfer) {
                oldBankChange = oldBankChange.plus(oldAmount)
              } else {
                oldCashChange = oldCashChange.plus(oldAmount)
              }
              oldCashChange = oldCashChange.minus(oldComission)
            }
          }
        }
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

                // Actualizar transacción de comisión si existe
                if (!comissionDiff.isZero()) {
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
                if (isTransfer) {
                  newBankChange = newBankChange.plus(paymentAmount)
                } else {
                  newCashChange = newCashChange.plus(paymentAmount)
                }
                // Comisión siempre afecta efectivo
                newCashChange = newCashChange.minus(paymentComission)
              }
            }
          } else if (!paymentInput.isDeleted && paymentAmount.greaterThan(0)) {
            // Nuevo pago - crear
            const loan = await this.loanRepository.findById(paymentInput.loanId)
            if (!loan) continue

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
                comission: paymentComission,
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
            if (paymentComission.greaterThan(0) && cashAccount) {
              await this.transactionRepository.create(
                {
                  amount: paymentComission,
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
            if (isTransfer) {
              newBankChange = newBankChange.plus(paymentAmount)
            } else {
              newCashChange = newCashChange.plus(paymentAmount)
            }
            newCashChange = newCashChange.minus(paymentComission)

            // Actualizar métricas del préstamo
            const currentTotalPaid = new Decimal(loan.totalPaid.toString())
            const currentPending = new Decimal(loan.pendingAmountStored.toString())
            const updatedPending = currentPending.minus(paymentAmount)

            await tx.loan.update({
              where: { id: loan.id },
              data: {
                totalPaid: currentTotalPaid.plus(paymentAmount),
                pendingAmountStored: updatedPending.isNegative() ? new Decimal(0) : updatedPending,
                comissionAmount: { increment: paymentComission },
                ...(updatedPending.lessThanOrEqualTo(0) && {
                  status: 'FINISHED',
                  finishedDate: new Date(),
                }),
              },
            })
          }
        }
      }

      // 3.1 Agregar el efecto del bankPaidAmount (transferencia de efectivo a banco)
      if (bankPaidAmount.greaterThan(0)) {
        newCashChange = newCashChange.minus(bankPaidAmount)
        newBankChange = newBankChange.plus(bankPaidAmount)
      }

      // 4. Manejar transacción de transferencia (bankPaidAmount)
      // Eliminar transferencia anterior si existe
      await tx.transaction.deleteMany({
        where: {
          leadPaymentReceived: id,
          type: 'TRANSFER',
        },
      })

      // Crear nueva transferencia si bankPaidAmount > 0
      if (bankPaidAmount.greaterThan(0) && cashAccount && bankAccount) {
        await this.transactionRepository.create(
          {
            amount: bankPaidAmount,
            date: new Date(),
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

      // 5. Calcular y aplicar cambios netos de balance
      // El viejo efecto del transfer también hay que revertirlo
      const oldBankPaidAmount = new Decimal(existingRecord.bankPaidAmount.toString())
      oldCashChange = oldCashChange.minus(oldBankPaidAmount)
      oldBankChange = oldBankChange.plus(oldBankPaidAmount)

      const netCashChange = newCashChange.minus(oldCashChange)
      const netBankChange = newBankChange.minus(oldBankChange)

      if (cashAccount && !netCashChange.isZero()) {
        await this.accountRepository.addToBalance(cashAccount.id, netCashChange, tx)
      }

      if (bankAccount && !netBankChange.isZero()) {
        await this.accountRepository.addToBalance(bankAccount.id, netBankChange, tx)
      }

      // Actualizar el registro LeadPaymentReceived
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
}
