import { GraphQLError } from 'graphql'
import { Decimal } from 'decimal.js'
import type { PrismaClient, Account } from '@solufacil/database'
import { AccountRepository } from '../repositories/AccountRepository'
import { BalanceService } from './BalanceService'

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
  entries: unknown[]
  /** @deprecated Use entries instead */
  transactions?: unknown[] // Backwards compatibility alias
}

interface RouteWithCashAccount {
  routeId: string
  routeName: string
  account: Account
  balance: Decimal
}

export class BatchTransferService {
  private accountRepository: AccountRepository
  private balanceService: BalanceService

  constructor(private prisma: PrismaClient) {
    this.accountRepository = new AccountRepository(prisma)
    this.balanceService = new BalanceService(prisma)
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
        entries: [],
        transactions: [], // Backwards compatibility
      }
    }

    // Execute all transfers using BalanceService
    const result = await this.prisma.$transaction(async (tx) => {
      const balanceService = new BalanceService(tx as any)
      const entries: unknown[] = []
      let totalAmount = new Decimal(0)

      for (const routeAccount of routesWithBalance) {
        const description = input.description || `Vaciado de ruta ${routeAccount.routeName}`

        // DEBIT from source (route cash account)
        const debitEntry = await balanceService.createEntry({
          accountId: routeAccount.account.id,
          entryType: 'DEBIT',
          amount: routeAccount.balance,
          sourceType: 'TRANSFER_OUT',
          entryDate: new Date(),
          destinationAccountId: input.destinationAccountId,
          description,
        }, tx)

        // CREDIT to destination
        const creditEntry = await balanceService.createEntry({
          accountId: input.destinationAccountId,
          entryType: 'CREDIT',
          amount: routeAccount.balance,
          sourceType: 'TRANSFER_IN',
          entryDate: new Date(),
          description,
        }, tx)

        entries.push(debitEntry, creditEntry)
        totalAmount = totalAmount.plus(routeAccount.balance)
      }

      return { entries, totalAmount }
    })

    return {
      success: true,
      message: `Se vaciaron ${routesWithBalance.length} rutas correctamente`,
      transactionsCreated: result.entries.length / 2, // Each transfer creates 2 entries
      totalAmount: result.totalAmount,
      entries: result.entries,
      transactions: result.entries, // Backwards compatibility
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
        entries: [],
        transactions: [], // Backwards compatibility
      }
    }

    // Execute all transfers using BalanceService
    const result = await this.prisma.$transaction(async (tx) => {
      const balanceService = new BalanceService(tx as any)
      const entries: unknown[] = []

      for (const [, { amount, routeAccount }] of amountsToDistribute) {
        const description = input.description || `Distribución a ruta ${routeAccount.routeName}`

        // DEBIT from source
        const debitEntry = await balanceService.createEntry({
          accountId: input.sourceAccountId,
          entryType: 'DEBIT',
          amount,
          sourceType: 'TRANSFER_OUT',
          entryDate: new Date(),
          destinationAccountId: routeAccount.account.id,
          description,
        }, tx)

        // CREDIT to destination (route cash account)
        const creditEntry = await balanceService.createEntry({
          accountId: routeAccount.account.id,
          entryType: 'CREDIT',
          amount,
          sourceType: 'TRANSFER_IN',
          entryDate: new Date(),
          description,
        }, tx)

        entries.push(debitEntry, creditEntry)
      }

      return { entries, totalAmount: totalToDistribute }
    })

    return {
      success: true,
      message: `Se distribuyó dinero a ${amountsToDistribute.size} rutas correctamente`,
      transactionsCreated: result.entries.length / 2, // Each transfer creates 2 entries
      totalAmount: result.totalAmount,
      entries: result.entries,
      transactions: result.entries, // Backwards compatibility
    }
  }
}
