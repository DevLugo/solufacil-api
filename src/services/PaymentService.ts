import { GraphQLError } from 'graphql'
import { Decimal } from 'decimal.js'
import type { PrismaClient, PaymentMethod, SourceType, AccountEntryType } from '@solufacil/database'
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

    // Collect unique loan IDs for bulk fetch
    const loanIds = [...new Set(input.payments.map(p => p.loanId))]

    return this.prisma.$transaction(async (tx) => {
      // 1. Bulk fetch: agent accounts + all loans in a single parallel call
      const [agent, loans] = await Promise.all([
        tx.employee.findUnique({
          where: { id: input.agentId },
          include: {
            routes: {
              include: {
                accounts: {
                  where: { type: { in: ['EMPLOYEE_CASH_FUND', 'BANK'] } }
                }
              }
            }
          }
        }),
        // Minimal fields needed for payment processing
        tx.loan.findMany({
          where: { id: { in: loanIds } },
          select: {
            id: true,
            profitAmount: true,
            totalDebtAcquired: true,
            badDebtDate: true,
            loantypeRelation: {
              select: { loanPaymentComission: true }
            }
          }
        })
      ])

      const agentAccounts = agent?.routes?.flatMap(r => r.accounts) || []
      const cashAccount = agentAccounts.find(a => a.type === 'EMPLOYEE_CASH_FUND')
      const bankAccount = agentAccounts.find(a => a.type === 'BANK')

      // Validar que exista cuenta de efectivo - es crítica para el ledger
      if (!cashAccount) {
        throw new GraphQLError(
          `No se encontró cuenta de efectivo (EMPLOYEE_CASH_FUND) para el empleado ${input.agentId}. Verifique que el empleado esté asignado a una ruta con cuentas configuradas.`,
          { extensions: { code: 'ACCOUNT_NOT_FOUND' } }
        )
      }

      // Create loan lookup map
      const loanMap = new Map(loans.map(l => [l.id, l]))

      // Detectar loans no encontrados y advertir
      const missingLoanIds = input.payments
        .map(p => p.loanId)
        .filter(loanId => !loanMap.has(loanId))

      if (missingLoanIds.length > 0) {
        console.warn(
          `[PaymentService.createLeadPaymentReceived] Préstamos no encontrados: ${missingLoanIds.join(', ')}. Estos pagos serán ignorados.`
        )
      }

      // 2. Create LeadPaymentReceived record
      const leadPaymentReceived = await tx.leadPaymentReceived.create({
        data: {
          expectedAmount,
          paidAmount,
          cashPaidAmount,
          bankPaidAmount,
          falcoAmount,
          paymentStatus,
          lead: input.leadId,
          agent: input.agentId,
          createdAt: paymentDate,
        }
      })

      // 3. Prepare all payments and account entries in memory
      const paymentDataList: {
        amount: Decimal
        comission: Decimal
        receivedAt: Date
        paymentMethod: PaymentMethod
        type: string
        loan: string
        leadPaymentReceived: string
      }[] = []

      // Track payment amounts per loan for metrics calculation
      const loanPaymentTotals = new Map<string, { totalPaid: Decimal; totalComission: Decimal }>()

      // Track direct bank payments
      let directBankPayments = new Decimal(0)

      // Process each payment input
      for (const paymentInput of input.payments) {
        const loan = loanMap.get(paymentInput.loanId)
        if (!loan) continue

        const paymentAmount = new Decimal(paymentInput.amount)
        const comissionAmount = paymentInput.comission !== undefined
          ? new Decimal(paymentInput.comission)
          : loan.loantypeRelation?.loanPaymentComission
            ? new Decimal(loan.loantypeRelation.loanPaymentComission.toString())
            : new Decimal(0)

        paymentDataList.push({
          amount: paymentAmount,
          comission: comissionAmount,
          receivedAt: paymentDate,
          paymentMethod: paymentInput.paymentMethod,
          type: 'PAYMENT',
          loan: paymentInput.loanId,
          leadPaymentReceived: leadPaymentReceived.id,
        })

        // Accumulate totals per loan
        const existing = loanPaymentTotals.get(paymentInput.loanId) || {
          totalPaid: new Decimal(0),
          totalComission: new Decimal(0)
        }
        existing.totalPaid = existing.totalPaid.plus(paymentAmount)
        existing.totalComission = existing.totalComission.plus(comissionAmount)
        loanPaymentTotals.set(paymentInput.loanId, existing)

        if (paymentInput.paymentMethod === 'MONEY_TRANSFER') {
          directBankPayments = directBankPayments.plus(paymentAmount)
        }
      }

      // 4. Batch insert all payments using createMany
      if (paymentDataList.length > 0) {
        await tx.loanPayment.createMany({
          data: paymentDataList.map(p => ({
            amount: p.amount,
            comission: p.comission,
            receivedAt: p.receivedAt,
            paymentMethod: p.paymentMethod,
            type: p.type,
            loan: p.loan,
            leadPaymentReceived: p.leadPaymentReceived,
          }))
        })
      }

      // 5. Fetch created payments to get their IDs for AccountEntry linking
      const createdPayments = await tx.loanPayment.findMany({
        where: { leadPaymentReceived: leadPaymentReceived.id },
        select: { id: true, loan: true, amount: true, comission: true, paymentMethod: true }
      })

      // 6. Prepare all AccountEntry records
      const accountEntries: {
        accountId: string
        amount: Decimal
        entryType: AccountEntryType
        sourceType: SourceType
        entryDate: Date
        description: string
        loanId: string | null
        loanPaymentId: string | null
        leadPaymentReceivedId: string | null
        profitAmount: Decimal | null
        returnToCapital: Decimal | null
        snapshotLeadId: string
        destinationAccountId: string | null
      }[] = []

      // Track balance changes per account
      const balanceChanges = new Map<string, Decimal>()

      for (const payment of createdPayments) {
        const loan = loanMap.get(payment.loan)
        if (!loan) continue

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
          accountEntries.push({
            accountId: destinationAccountId,
            amount: paymentAmount,
            entryType: 'CREDIT',
            sourceType: isTransfer ? 'LOAN_PAYMENT_BANK' : 'LOAN_PAYMENT_CASH',
            entryDate: paymentDate,
            description: '',
            loanId: loan.id,
            loanPaymentId: payment.id,
            leadPaymentReceivedId: leadPaymentReceived.id,
            profitAmount,
            returnToCapital,
            snapshotLeadId: input.leadId,
            destinationAccountId: null,
          })
          // Accumulate balance change (CREDIT = add)
          const current = balanceChanges.get(destinationAccountId) || new Decimal(0)
          balanceChanges.set(destinationAccountId, current.plus(paymentAmount))
        }

        // DEBIT: Commission
        if (comissionAmount.greaterThan(0) && cashAccount) {
          accountEntries.push({
            accountId: cashAccount.id,
            amount: comissionAmount,
            entryType: 'DEBIT',
            sourceType: 'PAYMENT_COMMISSION',
            entryDate: paymentDate,
            description: '',
            loanId: null,
            loanPaymentId: payment.id,
            leadPaymentReceivedId: leadPaymentReceived.id,
            profitAmount: null,
            returnToCapital: null,
            snapshotLeadId: input.leadId,
            destinationAccountId: null,
          })
          // Accumulate balance change (DEBIT = subtract)
          const current = balanceChanges.get(cashAccount.id) || new Decimal(0)
          balanceChanges.set(cashAccount.id, current.minus(comissionAmount))
        }
      }

      // 7. Handle cash-to-bank transfer entries
      const cashToBank = bankPaidAmount.minus(directBankPayments)
      if (cashToBank.greaterThan(0) && cashAccount && bankAccount) {
        // DEBIT from cash (TRANSFER_OUT)
        accountEntries.push({
          accountId: cashAccount.id,
          amount: cashToBank,
          entryType: 'DEBIT',
          sourceType: 'TRANSFER_OUT',
          entryDate: paymentDate,
          description: `Depósito efectivo a banco - LPR ${leadPaymentReceived.id}`,
          loanId: null,
          loanPaymentId: null,
          leadPaymentReceivedId: leadPaymentReceived.id,
          profitAmount: null,
          returnToCapital: null,
          snapshotLeadId: input.leadId,
          destinationAccountId: bankAccount.id,
        })
        const cashCurrent = balanceChanges.get(cashAccount.id) || new Decimal(0)
        balanceChanges.set(cashAccount.id, cashCurrent.minus(cashToBank))

        // CREDIT to bank (TRANSFER_IN)
        accountEntries.push({
          accountId: bankAccount.id,
          amount: cashToBank,
          entryType: 'CREDIT',
          sourceType: 'TRANSFER_IN',
          entryDate: paymentDate,
          description: `Depósito efectivo a banco - LPR ${leadPaymentReceived.id}`,
          loanId: null,
          loanPaymentId: null,
          leadPaymentReceivedId: leadPaymentReceived.id,
          profitAmount: null,
          returnToCapital: null,
          snapshotLeadId: input.leadId,
          destinationAccountId: cashAccount.id,
        })
        const bankCurrent = balanceChanges.get(bankAccount.id) || new Decimal(0)
        balanceChanges.set(bankAccount.id, bankCurrent.plus(cashToBank))
      }

      // 8. Handle falco entry
      if (falcoAmount.greaterThan(0) && cashAccount) {
        accountEntries.push({
          accountId: cashAccount.id,
          amount: falcoAmount,
          entryType: 'DEBIT',
          sourceType: 'FALCO_LOSS',
          entryDate: paymentDate,
          description: `Pérdida por falco - LPR ${leadPaymentReceived.id}`,
          loanId: null,
          loanPaymentId: null,
          leadPaymentReceivedId: leadPaymentReceived.id,
          profitAmount: null,
          returnToCapital: null,
          snapshotLeadId: input.leadId,
          destinationAccountId: null,
        })
        const current = balanceChanges.get(cashAccount.id) || new Decimal(0)
        balanceChanges.set(cashAccount.id, current.minus(falcoAmount))
      }

      // 9. Batch insert all AccountEntry records
      if (accountEntries.length > 0) {
        await tx.accountEntry.createMany({
          data: accountEntries.map(e => ({
            accountId: e.accountId,
            amount: e.amount,
            entryType: e.entryType,
            sourceType: e.sourceType,
            entryDate: e.entryDate,
            description: e.description,
            loanId: e.loanId,
            loanPaymentId: e.loanPaymentId,
            leadPaymentReceivedId: e.leadPaymentReceivedId,
            profitAmount: e.profitAmount,
            returnToCapital: e.returnToCapital,
            snapshotLeadId: e.snapshotLeadId,
            destinationAccountId: e.destinationAccountId,
          }))
        })
      }

      // 10. Batch update account balances (one update per account)
      const accountUpdatePromises = Array.from(balanceChanges.entries()).map(
        ([accountId, change]) =>
          tx.account.update({
            where: { id: accountId },
            data: { amount: { increment: change } }
          })
      )
      if (accountUpdatePromises.length > 0) {
        await Promise.all(accountUpdatePromises)
      }

      // 11. Batch update loan metrics (one update per loan)
      // First, get current totals for all affected loans
      const loanMetricsPromises = Array.from(loanPaymentTotals.keys()).map(async (loanId) => {
        const loan = loanMap.get(loanId)
        if (!loan) return

        // Get total paid from all payments for this loan
        const paymentsAggregate = await tx.loanPayment.aggregate({
          where: { loan: loanId },
          _sum: { amount: true, comission: true }
        })

        const totalPaid = new Decimal(paymentsAggregate._sum.amount?.toString() || '0')
        const totalDebt = new Decimal(loan.totalDebtAcquired.toString())
        const pendingAmountStored = Decimal.max(totalDebt.minus(totalPaid), new Decimal(0))
        const isFinished = pendingAmountStored.lessThanOrEqualTo(0)

        return tx.loan.update({
          where: { id: loanId },
          data: {
            totalPaid,
            pendingAmountStored,
            ...(isFinished && {
              status: 'FINISHED',
              finishedDate: paymentDate,
            }),
            ...(!isFinished && {
              status: 'ACTIVE',
              finishedDate: null,
            }),
          }
        })
      })
      await Promise.all(loanMetricsPromises)

      // 12. Fetch and return the complete LeadPaymentReceived with payments
      return tx.leadPaymentReceived.findUniqueOrThrow({
        where: { id: leadPaymentReceived.id },
        include: {
          leadRelation: {
            include: { personalDataRelation: true }
          },
          agentRelation: {
            include: { personalDataRelation: true }
          },
          payments: true,
        }
      })
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
        }, tx)
      }

      return falcoCompensatoryPayment
    })
  }
}
