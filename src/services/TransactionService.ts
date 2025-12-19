import { GraphQLError } from 'graphql'
import { Decimal } from 'decimal.js'
import type { PrismaClient, TransactionType } from '@solufacil/database'
import { TransactionRepository } from '../repositories/TransactionRepository'
import { AccountRepository } from '../repositories/AccountRepository'

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

export class TransactionService {
  private transactionRepository: TransactionRepository
  private accountRepository: AccountRepository

  constructor(private prisma: PrismaClient) {
    this.transactionRepository = new TransactionRepository(prisma)
    this.accountRepository = new AccountRepository(prisma)
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

    // Ejecutar creación en transacción para actualizar balances
    return this.prisma.$transaction(async (tx) => {
      const transaction = await this.transactionRepository.create(
        {
          amount,
          date: input.date,
          type: input.type,
          incomeSource: input.incomeSource,
          expenseSource: input.expenseSource,
          sourceAccountId: input.sourceAccountId,
          destinationAccountId: input.destinationAccountId,
          loanId: input.loanId,
          loanPaymentId: input.loanPaymentId,
          routeId: input.routeId,
          leadId: input.leadId,
        },
        tx
      )

      // Recalcular balance de cuenta origen
      if (input.sourceAccountId) {
        await this.accountRepository.recalculateAndUpdateBalance(input.sourceAccountId, tx)
      }

      // Recalcular balance de cuenta destino si existe
      if (input.destinationAccountId) {
        await this.accountRepository.recalculateAndUpdateBalance(input.destinationAccountId, tx)
      }

      return transaction
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

    // Ejecutar transferencia en transacción
    return this.prisma.$transaction(async (tx) => {
      // Crear transacción de transferencia
      const transaction = await this.transactionRepository.create(
        {
          amount,
          date: new Date(),
          type: 'TRANSFER',
          expenseSource: input.description || 'TRANSFER',
          sourceAccountId: input.sourceAccountId,
          destinationAccountId: input.destinationAccountId,
        },
        tx
      )

      // Recalcular saldos de ambas cuentas desde transacciones
      await this.accountRepository.recalculateAndUpdateBalance(input.sourceAccountId, tx)
      await this.accountRepository.recalculateAndUpdateBalance(input.destinationAccountId, tx)

      return transaction
    })
  }

  async update(id: string, input: UpdateTransactionInput) {
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

      // Recalcular balance de la cuenta anterior si cambió
      if (input.sourceAccountId && input.sourceAccountId !== oldSourceAccountId) {
        await this.accountRepository.recalculateAndUpdateBalance(oldSourceAccountId, tx)
      }

      // Siempre recalcular la cuenta actual/nueva
      await this.accountRepository.recalculateAndUpdateBalance(newSourceAccountId, tx)

      return updatedTransaction
    })
  }

  async delete(id: string) {
    // Obtener transacción actual
    const existingTransaction = await this.transactionRepository.findById(id)
    if (!existingTransaction) {
      throw new GraphQLError('Transaction not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const sourceAccountId = existingTransaction.sourceAccount
    const destinationAccountId = existingTransaction.destinationAccount

    return this.prisma.$transaction(async (tx) => {
      // Eliminar la transacción
      await this.transactionRepository.delete(id, tx)

      // Recalcular balance de la cuenta fuente
      await this.accountRepository.recalculateAndUpdateBalance(sourceAccountId, tx)

      // Si hay cuenta destino (transferencias), también recalcular
      if (destinationAccountId) {
        await this.accountRepository.recalculateAndUpdateBalance(destinationAccountId, tx)
      }

      return true
    })
  }
}
