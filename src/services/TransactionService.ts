import { GraphQLError } from 'graphql'
import { Decimal } from 'decimal.js'
import type { PrismaClient, TransactionType, SourceType } from '@solufacil/database'
import { TransactionRepository } from '../repositories/TransactionRepository'
import { AccountRepository } from '../repositories/AccountRepository'
import { BalanceService } from './BalanceService'

export interface CreateTransactionInput {
  amount: string | number
  date: Date
  type: TransactionType
  incomeSource?: string
  expenseSource?: string
  sourceAccountId?: string
  destinationAccountId?: string
  loanId?: string
  loanPaymentId?: string
  routeId?: string
  leadId?: string
}

export interface TransferInput {
  amount: string | number
  sourceAccountId: string
  destinationAccountId: string
  description?: string
}

export interface UpdateTransactionInput {
  amount?: string | number
  expenseSource?: string
  incomeSource?: string
  sourceAccountId?: string
  description?: string
}

/**
 * Maps old expense/income source strings to new SourceType enum
 */
function mapToSourceType(type: TransactionType, incomeSource?: string, expenseSource?: string): SourceType {
  if (type === 'INCOME') {
    switch (incomeSource) {
      case 'CASH_LOAN_PAYMENT': return 'LOAN_PAYMENT_CASH'
      case 'BANK_LOAN_PAYMENT': return 'LOAN_PAYMENT_BANK'
      default: return 'BALANCE_ADJUSTMENT'
    }
  } else if (type === 'EXPENSE') {
    switch (expenseSource) {
      case 'LOAN_GRANTED': return 'LOAN_GRANT'
      case 'LOAN_GRANTED_COMISSION': return 'LOAN_GRANT_COMMISSION'
      case 'LOAN_PAYMENT_COMISSION': return 'PAYMENT_COMMISSION'
      case 'GASOLINE': return 'GASOLINE'
      case 'GASOLINE_TOKA': return 'GASOLINE_TOKA'
      case 'NOMINA_SALARY': return 'NOMINA_SALARY'
      case 'EXTERNAL_SALARY': return 'EXTERNAL_SALARY'
      case 'VIATIC': return 'VIATIC'
      case 'TRAVEL_EXPENSES': return 'TRAVEL_EXPENSES'
      case 'FALCO_LOSS': return 'FALCO_LOSS'
      case 'FALCO_COMPENSATORY': return 'FALCO_COMPENSATORY'
      default: return 'BALANCE_ADJUSTMENT'
    }
  }
  return 'BALANCE_ADJUSTMENT'
}

export class TransactionService {
  private transactionRepository: TransactionRepository
  private accountRepository: AccountRepository
  private balanceService: BalanceService

  constructor(private prisma: PrismaClient) {
    this.transactionRepository = new TransactionRepository(prisma)
    this.accountRepository = new AccountRepository(prisma)
    this.balanceService = new BalanceService(prisma)
  }

  async findById(id: string) {
    const transaction = await this.transactionRepository.findById(id)
    if (!transaction) {
      throw new GraphQLError('Transaction not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }
    return transaction
  }

  async findMany(options?: {
    type?: TransactionType
    routeId?: string
    accountId?: string
    fromDate?: Date
    toDate?: Date
    limit?: number
    offset?: number
  }) {
    return this.transactionRepository.findMany(options)
  }

  async create(input: CreateTransactionInput) {
    // Validar que la cuenta origen existe (si se proporciona)
    if (input.sourceAccountId) {
      const sourceExists = await this.accountRepository.exists(input.sourceAccountId)
      if (!sourceExists) {
        throw new GraphQLError('Source account not found', {
          extensions: { code: 'NOT_FOUND' },
        })
      }
    }

    // Validar cuenta destino si se proporciona
    if (input.destinationAccountId) {
      const destExists = await this.accountRepository.exists(input.destinationAccountId)
      if (!destExists) {
        throw new GraphQLError('Destination account not found', {
          extensions: { code: 'NOT_FOUND' },
        })
      }
    }

    const amount = new Decimal(input.amount)
    const sourceType = mapToSourceType(input.type, input.incomeSource, input.expenseSource)

    // Ejecutar creación usando BalanceService (crea AccountEntry)
    return this.prisma.$transaction(async (tx) => {
      const balanceService = new BalanceService(tx as any)

      // Crear AccountEntry según tipo de transacción
      if (input.type === 'INCOME' && input.sourceAccountId) {
        // INCOME = CREDIT (dinero entra)
        await balanceService.createEntry({
          accountId: input.sourceAccountId,
          entryType: 'CREDIT',
          amount,
          sourceType,
          entryDate: input.date,
          loanId: input.loanId,
          loanPaymentId: input.loanPaymentId,
          snapshotLeadId: input.leadId || '',
          snapshotRouteId: input.routeId || '',
          description: input.incomeSource || '',
        }, tx)
      } else if (input.type === 'EXPENSE' && input.sourceAccountId) {
        // EXPENSE = DEBIT (dinero sale)
        await balanceService.createEntry({
          accountId: input.sourceAccountId,
          entryType: 'DEBIT',
          amount,
          sourceType,
          entryDate: input.date,
          loanId: input.loanId,
          snapshotLeadId: input.leadId || '',
          snapshotRouteId: input.routeId || '',
          description: input.expenseSource || '',
        }, tx)
      } else if (input.type === 'TRANSFER') {
        // TRANSFER = DEBIT del origen + CREDIT al destino
        if (input.sourceAccountId) {
          await balanceService.createEntry({
            accountId: input.sourceAccountId,
            entryType: 'DEBIT',
            amount,
            sourceType: 'TRANSFER_OUT',
            entryDate: input.date,
            snapshotLeadId: input.leadId || '',
            snapshotRouteId: input.routeId || '',
            destinationAccountId: input.destinationAccountId,
          }, tx)
        }
        if (input.destinationAccountId) {
          await balanceService.createEntry({
            accountId: input.destinationAccountId,
            entryType: 'CREDIT',
            amount,
            sourceType: 'TRANSFER_IN',
            entryDate: input.date,
            snapshotLeadId: input.leadId || '',
            snapshotRouteId: input.routeId || '',
          }, tx)
        }
      }

      // Retornar un objeto compatible con Transaction para mantener API
      // Nota: Ya no creamos Transaction, solo AccountEntry
      return {
        id: `entry-${Date.now()}`, // ID temporal, no se guarda en Transaction
        amount,
        date: input.date,
        type: input.type,
        incomeSource: input.incomeSource,
        expenseSource: input.expenseSource,
        sourceAccount: input.sourceAccountId,
        destinationAccount: input.destinationAccountId,
        loan: input.loanId,
        loanPayment: input.loanPaymentId,
        route: input.routeId,
        snapshotLeadId: input.leadId,
        createdAt: new Date(),
      }
    })
  }

  async transferBetweenAccounts(input: TransferInput) {
    // Validar cuentas
    const sourceAccount = await this.accountRepository.findById(input.sourceAccountId)
    if (!sourceAccount) {
      throw new GraphQLError('Source account not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const destAccount = await this.accountRepository.findById(input.destinationAccountId)
    if (!destAccount) {
      throw new GraphQLError('Destination account not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const amount = new Decimal(input.amount)
    const sourceBalance = new Decimal(sourceAccount.amount.toString())

    // Validar saldo suficiente
    if (sourceBalance.lessThan(amount)) {
      throw new GraphQLError('Insufficient balance in source account', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    // Ejecutar transferencia usando BalanceService
    return this.prisma.$transaction(async (tx) => {
      const balanceService = new BalanceService(tx as any)

      // DEBIT del origen
      await balanceService.createEntry({
        accountId: input.sourceAccountId,
        entryType: 'DEBIT',
        amount,
        sourceType: 'TRANSFER_OUT',
        entryDate: new Date(),
        destinationAccountId: input.destinationAccountId,
        description: input.description || 'Transfer',
      }, tx)

      // CREDIT al destino
      await balanceService.createEntry({
        accountId: input.destinationAccountId,
        entryType: 'CREDIT',
        amount,
        sourceType: 'TRANSFER_IN',
        entryDate: new Date(),
        description: input.description || 'Transfer',
      }, tx)

      // Retornar objeto compatible con Transaction para mantener API
      return {
        id: `transfer-${Date.now()}`,
        amount,
        date: new Date(),
        type: 'TRANSFER' as const,
        expenseSource: input.description || 'TRANSFER',
        sourceAccount: input.sourceAccountId,
        destinationAccount: input.destinationAccountId,
        createdAt: new Date(),
      }
    })
  }

  /**
   * @deprecated Este método opera sobre Transaction legacy.
   * Las nuevas operaciones usan AccountEntry via BalanceService.
   * Solo usar para editar transacciones creadas antes de la migración.
   */
  async update(id: string, input: UpdateTransactionInput) {
    console.warn('[DEPRECATED] TransactionService.update() - Use AccountEntry for new operations')

    // Obtener transacción actual
    const existingTransaction = await this.transactionRepository.findById(id)
    if (!existingTransaction) {
      throw new GraphQLError('Transaction not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Si se está cambiando la cuenta, validar que existe
    if (input.sourceAccountId) {
      const accountExists = await this.accountRepository.exists(input.sourceAccountId)
      if (!accountExists) {
        throw new GraphQLError('Source account not found', {
          extensions: { code: 'NOT_FOUND' },
        })
      }
    }

    const oldSourceAccountId = existingTransaction.sourceAccount
    const newSourceAccountId = input.sourceAccountId || oldSourceAccountId

    return this.prisma.$transaction(async (tx) => {
      // Actualizar la transacción
      const updatedTransaction = await this.transactionRepository.update(
        id,
        {
          amount: input.amount ? new Decimal(input.amount) : undefined,
          expenseSource: input.expenseSource,
          incomeSource: input.incomeSource,
          sourceAccountId: input.sourceAccountId,
        },
        tx
      )

      // Ajustar balances según el cambio
      const oldAmount = new Decimal(existingTransaction.amount.toString())
      const newAmount = input.amount ? new Decimal(input.amount) : oldAmount
      const transactionType = existingTransaction.type

      // Si cambió la cuenta, revertir en la antigua y aplicar en la nueva
      if (input.sourceAccountId && input.sourceAccountId !== oldSourceAccountId) {
        // Revertir de la cuenta antigua
        if (transactionType === 'INCOME') {
          await this.accountRepository.subtractFromBalance(oldSourceAccountId, oldAmount, tx)
        } else if (transactionType === 'EXPENSE') {
          await this.accountRepository.addToBalance(oldSourceAccountId, oldAmount, tx)
        }
        // Aplicar a la cuenta nueva
        if (transactionType === 'INCOME') {
          await this.accountRepository.addToBalance(newSourceAccountId, newAmount, tx)
        } else if (transactionType === 'EXPENSE') {
          await this.accountRepository.subtractFromBalance(newSourceAccountId, newAmount, tx)
        }
      } else if (!oldAmount.equals(newAmount)) {
        // Solo cambió el monto, aplicar la diferencia
        const difference = newAmount.minus(oldAmount)
        if (transactionType === 'INCOME') {
          await this.accountRepository.addToBalance(newSourceAccountId, difference, tx)
        } else if (transactionType === 'EXPENSE') {
          await this.accountRepository.subtractFromBalance(newSourceAccountId, difference, tx)
        }
      }

      return updatedTransaction
    })
  }

  /**
   * @deprecated Este método opera sobre Transaction legacy.
   * Las nuevas operaciones usan AccountEntry via BalanceService.
   * Solo usar para eliminar transacciones creadas antes de la migración.
   */
  async delete(id: string) {
    console.warn('[DEPRECATED] TransactionService.delete() - Use AccountEntry for new operations')

    // Obtener transacción actual
    const existingTransaction = await this.transactionRepository.findById(id)
    if (!existingTransaction) {
      throw new GraphQLError('Transaction not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const sourceAccountId = existingTransaction.sourceAccount
    const destinationAccountId = existingTransaction.destinationAccount

    const amount = new Decimal(existingTransaction.amount.toString())
    const transactionType = existingTransaction.type

    return this.prisma.$transaction(async (tx) => {
      // Eliminar la transacción
      await this.transactionRepository.delete(id, tx)

      // Revertir el efecto en los balances
      if (transactionType === 'INCOME' && sourceAccountId) {
        // INCOME sumó al balance, hay que restarlo
        await this.accountRepository.subtractFromBalance(sourceAccountId, amount, tx)
      } else if (transactionType === 'EXPENSE' && sourceAccountId) {
        // EXPENSE restó del balance, hay que sumarlo
        await this.accountRepository.addToBalance(sourceAccountId, amount, tx)
      } else if (transactionType === 'TRANSFER') {
        // TRANSFER restó del origen y sumó al destino, hay que revertir ambos
        if (sourceAccountId) {
          await this.accountRepository.addToBalance(sourceAccountId, amount, tx)
        }
        if (destinationAccountId) {
          await this.accountRepository.subtractFromBalance(destinationAccountId, amount, tx)
        }
      }

      return true
    })
  }
}
