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

      // Actualizar balance según tipo de transacción
      if (input.type === 'INCOME' && input.sourceAccountId) {
        // INCOME suma al balance
        await this.accountRepository.addToBalance(input.sourceAccountId, amount, tx)
      } else if (input.type === 'EXPENSE' && input.sourceAccountId) {
        // EXPENSE resta del balance
        await this.accountRepository.subtractFromBalance(input.sourceAccountId, amount, tx)
      } else if (input.type === 'TRANSFER') {
        // TRANSFER resta del origen y suma al destino
        if (input.sourceAccountId) {
          await this.accountRepository.subtractFromBalance(input.sourceAccountId, amount, tx)
        }
        if (input.destinationAccountId) {
          await this.accountRepository.addToBalance(input.destinationAccountId, amount, tx)
        }
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

      // Restar del origen y sumar al destino
      await this.accountRepository.subtractFromBalance(input.sourceAccountId, amount, tx)
      await this.accountRepository.addToBalance(input.destinationAccountId, amount, tx)

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
