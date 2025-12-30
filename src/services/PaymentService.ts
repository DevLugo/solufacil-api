import { GraphQLError } from 'graphql'
import { Decimal } from 'decimal.js'
import type { PrismaClient, PaymentMethod } from '@solufacil/database'
import { PaymentRepository } from '../repositories/PaymentRepository'
import { LoanRepository } from '../repositories/LoanRepository'
import { AccountRepository } from '../repositories/AccountRepository'
import { BalanceService } from './BalanceService'
import { calculatePaymentProfit } from '@solufacil/business-logic'

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

  /**
   * Recalcula totalPaid y pendingAmountStored desde la fuente de verdad (suma de pagos).
   * Similar a cómo calculamos el balance de cuentas desde AccountEntry.
   * Esto evita inconsistencias por operaciones incrementales.
   */
  private async recalculateLoanMetrics(
    loanId: string,
    tx: PrismaClient | any
  ): Promise<{ totalPaid: Decimal; pendingAmountStored: Decimal; totalComissions: Decimal }> {
    // Obtener el préstamo con su deuda total
    const loan = await tx.loan.findUnique({
      where: { id: loanId },
      select: {
        totalDebtAcquired: true,
        comissionAmount: true,
      },
    })

    if (!loan) {
      throw new GraphQLError('Loan not found', { extensions: { code: 'NOT_FOUND' } })
    }

    // Calcular suma de todos los pagos del préstamo
    const paymentsAggregate = await tx.loanPayment.aggregate({
      where: { loan: loanId },
      _sum: {
        amount: true,
        comission: true,
      },
    })

    const totalPaid = new Decimal(paymentsAggregate._sum.amount?.toString() || '0')
    const totalComissions = new Decimal(paymentsAggregate._sum.comission?.toString() || '0')
    const totalDebt = new Decimal(loan.totalDebtAcquired.toString())

    // pendingAmountStored = totalDebtAcquired - totalPaid (mínimo 0)
    const pendingAmountStored = Decimal.max(totalDebt.minus(totalPaid), new Decimal(0))

    return { totalPaid, pendingAmountStored, totalComissions }
  }

  /**
   * Actualiza las métricas del préstamo recalculándolas desde los pagos.
   * También actualiza el status a FINISHED si pendingAmountStored <= 0.
   *
   * @param loanId - ID del préstamo
   * @param tx - Transacción de Prisma
   * @param finishedDate - Fecha de finalización (si aplica)
   * @param baseComission - Comisión base del préstamo (comisión de otorgamiento)
   */
  private async updateLoanMetricsFromPayments(
    loanId: string,
    tx: PrismaClient | any,
    finishedDate?: Date,
    baseComission?: Decimal
  ): Promise<void> {
    const { totalPaid, pendingAmountStored, totalComissions } = await this.recalculateLoanMetrics(loanId, tx)

    const isFinished = pendingAmountStored.lessThanOrEqualTo(0)

    // Obtener la comisión base del préstamo si no se proporcionó
    // (comisión de otorgamiento que no está en los pagos)
    let loanGrantComission = baseComission
    if (!loanGrantComission) {
      const loan = await tx.loan.findUnique({
        where: { id: loanId },
        select: { loantypeRelation: { select: { loanGrantedComission: true } } },
      })
      // La comisión de otorgamiento ya está en loan.comissionAmount inicial
      // Aquí solo sumamos las comisiones de los pagos
    }

    await tx.loan.update({
      where: { id: loanId },
      data: {
        totalPaid,
        pendingAmountStored,
        ...(isFinished && {
          status: 'FINISHED',
          finishedDate: finishedDate || new Date(),
        }),
        ...(!isFinished && {
          status: 'ACTIVE',
          finishedDate: null,
        }),
      },
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

        // Recalcular métricas del préstamo desde la fuente de verdad (pagos)
        await this.updateLoanMetricsFromPayments(loan.id, tx, paymentDate)
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

      // Recalcular métricas del préstamo desde la fuente de verdad (pagos)
      if (!amountDiff.isZero()) {
        await this.updateLoanMetricsFromPayments(loan.id, tx)
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

      // Recalcular métricas del préstamo desde la fuente de verdad (pagos)
      await this.updateLoanMetricsFromPayments(loan.id, tx)

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

              if (paymentInput.isDeleted) {
                // Delete the payment
                await tx.loanPayment.delete({
                  where: { id: paymentInput.paymentId },
                })

                // Recalcular métricas del préstamo desde la fuente de verdad (pagos)
                const loan = existingPayment.loanRelation
                await this.updateLoanMetricsFromPayments(loan.id, tx)
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

                // Recalcular métricas del préstamo si cambió el monto
                const amountDiff = paymentAmount.minus(oldAmount)

                if (!amountDiff.isZero()) {
                  const loan = existingPayment.loanRelation
                  await this.updateLoanMetricsFromPayments(loan.id, tx)
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
                // Use the LeadPaymentReceived's date, not current date
                // This ensures the payment is associated with the correct day
                receivedAt: existingRecord.createdAt,
                paymentMethod: paymentInput.paymentMethod,
                type: 'PAYMENT',
                loan: paymentInput.loanId,
                leadPaymentReceived: id,
              },
              tx
            )

            // Recalcular métricas del préstamo desde la fuente de verdad (pagos)
            await this.updateLoanMetricsFromPayments(loan.id, tx)
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
