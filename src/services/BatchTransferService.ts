import { GraphQLError } from 'graphql'
import { Decimal } from 'decimal.js'
import type { PrismaClient, Account } from '@solufacil/database'
import { TransactionRepository } from '../repositories/TransactionRepository'
import { AccountRepository } from '../repositories/AccountRepository'

export interface DrainRoutesInput {
  routeIds: string[]
  destinationAccountId: string
  description?: string
}

export interface RouteAmountInput {
  routeId: string
  amount: string | number
}

export interface DistributeMoneyInput {
  sourceAccountId: string
  routeIds: string[]
  distributionMode: 'FIXED_EQUAL' | 'VARIABLE'
  fixedAmount?: string | number
  variableAmounts?: RouteAmountInput[]
  description?: string
}

export interface BatchTransferResult {
  success: boolean
  message: string
  transactionsCreated: number
  totalAmount: Decimal
  transactions: unknown[]
}

interface RouteWithCashAccount {
  routeId: string
  routeName: string
  account: Account
  balance: Decimal
}

export class BatchTransferService {
  private transactionRepository: TransactionRepository
  private accountRepository: AccountRepository

  constructor(private prisma: PrismaClient) {
    this.transactionRepository = new TransactionRepository(prisma)
    this.accountRepository = new AccountRepository(prisma)
  }

  /**
   * Get EMPLOYEE_CASH_FUND accounts for a list of routes
   */
  private async getRouteCashAccounts(routeIds: string[]): Promise<RouteWithCashAccount[]> {
    const routes = await this.prisma.route.findMany({
      where: { id: { in: routeIds } },
      include: {
        accounts: {
          where: { type: 'EMPLOYEE_CASH_FUND' },
        },
      },
    })

    const result: RouteWithCashAccount[] = []

    for (const route of routes) {
      const cashAccount = route.accounts.find((a) => a.type === 'EMPLOYEE_CASH_FUND')
      if (cashAccount) {
        result.push({
          routeId: route.id,
          routeName: route.name,
          account: cashAccount,
          balance: new Decimal(cashAccount.amount?.toString() || '0'),
        })
      }
    }

    return result
  }

  /**
   * Drain all routes - Transfer all money from each route's EMPLOYEE_CASH_FUND to a destination account
   */
  async drainRoutes(input: DrainRoutesInput): Promise<BatchTransferResult> {
    // Validate destination account
    const destAccount = await this.accountRepository.findById(input.destinationAccountId)
    if (!destAccount) {
      throw new GraphQLError('Destination account not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Get all route cash accounts
    const routeAccounts = await this.getRouteCashAccounts(input.routeIds)

    if (routeAccounts.length === 0) {
      throw new GraphQLError('No EMPLOYEE_CASH_FUND accounts found for the selected routes', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    // Filter routes with positive balance
    const routesWithBalance = routeAccounts.filter((r) => r.balance.greaterThan(0))

    if (routesWithBalance.length === 0) {
      return {
        success: true,
        message: 'No hay saldo para transferir en las rutas seleccionadas',
        transactionsCreated: 0,
        totalAmount: new Decimal(0),
        transactions: [],
      }
    }

    // Execute all transfers in a single transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const transactions: unknown[] = []
      let totalAmount = new Decimal(0)
      const accountsToRecalculate = new Set<string>()

      for (const routeAccount of routesWithBalance) {
        // Create transfer transaction
        const transaction = await this.transactionRepository.create(
          {
            amount: routeAccount.balance,
            date: new Date(),
            type: 'TRANSFER',
            expenseSource: input.description || `Vaciado de ruta ${routeAccount.routeName}`,
            sourceAccountId: routeAccount.account.id,
            destinationAccountId: input.destinationAccountId,
            routeId: routeAccount.routeId,
          },
          tx
        )

        transactions.push(transaction)
        totalAmount = totalAmount.plus(routeAccount.balance)

        // Restar del balance de la cuenta origen
        await this.accountRepository.subtractFromBalance(routeAccount.account.id, routeAccount.balance, tx)
      }

      // Sumar al balance de la cuenta destino
      await this.accountRepository.addToBalance(input.destinationAccountId, totalAmount, tx)

      return { transactions, totalAmount }
    })

    return {
      success: true,
      message: `Se vaciaron ${routesWithBalance.length} rutas correctamente`,
      transactionsCreated: result.transactions.length,
      totalAmount: result.totalAmount,
      transactions: result.transactions,
    }
  }

  /**
   * Distribute money - Transfer money from a source account to multiple route's EMPLOYEE_CASH_FUND accounts
   */
  async distributeMoney(input: DistributeMoneyInput): Promise<BatchTransferResult> {
    // Validate source account
    const sourceAccount = await this.accountRepository.findById(input.sourceAccountId)
    if (!sourceAccount) {
      throw new GraphQLError('Source account not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const sourceBalance = new Decimal(sourceAccount.amount?.toString() || '0')

    // Get all route cash accounts
    const routeAccounts = await this.getRouteCashAccounts(input.routeIds)

    if (routeAccounts.length === 0) {
      throw new GraphQLError('No EMPLOYEE_CASH_FUND accounts found for the selected routes', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    // Calculate amounts based on distribution mode
    const amountsToDistribute: Map<string, { amount: Decimal; routeAccount: RouteWithCashAccount }> =
      new Map()
    let totalToDistribute = new Decimal(0)

    if (input.distributionMode === 'FIXED_EQUAL') {
      if (!input.fixedAmount) {
        throw new GraphQLError('Fixed amount is required for FIXED_EQUAL distribution mode', {
          extensions: { code: 'BAD_USER_INPUT' },
        })
      }

      const fixedAmount = new Decimal(input.fixedAmount)

      for (const routeAccount of routeAccounts) {
        amountsToDistribute.set(routeAccount.routeId, { amount: fixedAmount, routeAccount })
        totalToDistribute = totalToDistribute.plus(fixedAmount)
      }
    } else if (input.distributionMode === 'VARIABLE') {
      if (!input.variableAmounts || input.variableAmounts.length === 0) {
        throw new GraphQLError('Variable amounts are required for VARIABLE distribution mode', {
          extensions: { code: 'BAD_USER_INPUT' },
        })
      }

      // Create a map of route amounts
      const variableMap = new Map(
        input.variableAmounts.map((v) => [v.routeId, new Decimal(v.amount)])
      )

      for (const routeAccount of routeAccounts) {
        const amount = variableMap.get(routeAccount.routeId)
        if (amount && amount.greaterThan(0)) {
          amountsToDistribute.set(routeAccount.routeId, { amount, routeAccount })
          totalToDistribute = totalToDistribute.plus(amount)
        }
      }
    }

    // Validate sufficient balance
    if (sourceBalance.lessThan(totalToDistribute)) {
      throw new GraphQLError(
        `Saldo insuficiente. Disponible: $${sourceBalance.toFixed(2)}, Requerido: $${totalToDistribute.toFixed(2)}`,
        {
          extensions: { code: 'BAD_USER_INPUT' },
        }
      )
    }

    if (amountsToDistribute.size === 0) {
      return {
        success: true,
        message: 'No hay montos para distribuir',
        transactionsCreated: 0,
        totalAmount: new Decimal(0),
        transactions: [],
      }
    }

    // Execute all transfers in a single transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const transactions: unknown[] = []
      const accountsToRecalculate = new Set<string>()

      for (const [, { amount, routeAccount }] of amountsToDistribute) {
        // Create transfer transaction
        const transaction = await this.transactionRepository.create(
          {
            amount,
            date: new Date(),
            type: 'TRANSFER',
            expenseSource: input.description || `Distribución a ruta ${routeAccount.routeName}`,
            sourceAccountId: input.sourceAccountId,
            destinationAccountId: routeAccount.account.id,
            routeId: routeAccount.routeId,
          },
          tx
        )

        transactions.push(transaction)

        // Sumar al balance de la cuenta destino
        await this.accountRepository.addToBalance(routeAccount.account.id, amount, tx)
      }

      // Restar del balance de la cuenta origen
      await this.accountRepository.subtractFromBalance(input.sourceAccountId, totalToDistribute, tx)

      return { transactions, totalAmount: totalToDistribute }
    })

    return {
      success: true,
      message: `Se distribuyó dinero a ${amountsToDistribute.size} rutas correctamente`,
      transactionsCreated: result.transactions.length,
      totalAmount: result.totalAmount,
      transactions: result.transactions,
    }
  }
}
