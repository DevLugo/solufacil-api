import type { PrismaClient, Account, AccountType, Prisma } from '@solufacil/database'
import { Decimal } from 'decimal.js'

/**
 * AccountRepository - Gestión de cuentas y balances
 *
 * ===============================================================
 * IMPORTANTE: POLÍTICA DE BALANCE DE CUENTAS
 * ===============================================================
 *
 * El campo `amount` de las cuentas representa el balance calculado
 * a partir de las transacciones. NUNCA debe modificarse directamente.
 *
 * En lugar de modificar `amount` manualmente:
 * 1. Crear la transacción correspondiente (INCOME, EXPENSE, TRANSFER)
 * 2. Llamar a `recalculateAndUpdateBalance()` para actualizar el balance
 *
 * Flujo correcto:
 * ```typescript
 * // Después de crear/editar/eliminar una transacción:
 * await accountRepository.recalculateAndUpdateBalance(accountId, tx)
 * ```
 *
 * Tipos de transacciones y su efecto en el balance:
 * - INCOME (sourceAccount=cuenta): +amount (dinero ENTRA)
 * - EXPENSE (sourceAccount=cuenta): -amount (dinero SALE)
 * - TRANSFER (destinationAccount=cuenta): +amount (dinero ENTRA)
 * - TRANSFER (sourceAccount=cuenta): -amount (dinero SALE)
 *
 * ===============================================================
 */
export class AccountRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.account.findUnique({
      where: { id },
      include: {
        routes: true,
      },
    })
  }

  async findMany(options?: { routeId?: string; type?: AccountType }) {
    const where: Prisma.AccountWhereInput = {}

    if (options?.type) {
      where.type = options.type
    }

    if (options?.routeId) {
      where.routes = { some: { id: options.routeId } }
    }

    return this.prisma.account.findMany({
      where,
      include: {
        routes: true,
      },
      orderBy: { name: 'asc' },
    })
  }

  async create(data: {
    name: string
    type: AccountType
    amount: Decimal
    routeIds?: string[]
  }) {
    return this.prisma.account.create({
      data: {
        name: data.name,
        type: data.type,
        amount: data.amount,
        routes: data.routeIds
          ? { connect: data.routeIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        routes: true,
      },
    })
  }

  async update(
    id: string,
    data: {
      name?: string
      isActive?: boolean
      amount?: Decimal
    }
  ) {
    return this.prisma.account.update({
      where: { id },
      data,
      include: {
        routes: true,
      },
    })
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.prisma.account.count({
      where: { id },
    })
    return count > 0
  }

  /**
   * Calcula el balance de una cuenta basándose en las transacciones.
   *
   * Lógica:
   * - INCOME (sourceAccount=this): Dinero que ENTRA a la cuenta (+)
   * - EXPENSE (sourceAccount=this): Dinero que SALE de la cuenta (-)
   * - TRANSFER (destinationAccount=this): Dinero que ENTRA desde otra cuenta (+)
   * - TRANSFER (sourceAccount=this, type!=INCOME): Dinero que SALE hacia otra cuenta (-)
   */
  async calculateBalance(id: string, tx?: Prisma.TransactionClient): Promise<Decimal> {
    const client = tx || this.prisma

    // INCOME: dinero que entra a esta cuenta
    const incomes = await client.transaction.aggregate({
      where: {
        sourceAccount: id,
        type: 'INCOME',
      },
      _sum: { amount: true },
    })

    // EXPENSE: dinero que sale de esta cuenta (gastos, préstamos otorgados, comisiones)
    const expenses = await client.transaction.aggregate({
      where: {
        sourceAccount: id,
        type: 'EXPENSE',
      },
      _sum: { amount: true },
    })

    // TRANSFER entrante: dinero que llega desde otra cuenta
    const transfersIn = await client.transaction.aggregate({
      where: {
        destinationAccount: id,
        type: 'TRANSFER',
      },
      _sum: { amount: true },
    })

    // TRANSFER saliente: dinero que se envía a otra cuenta
    const transfersOut = await client.transaction.aggregate({
      where: {
        sourceAccount: id,
        type: 'TRANSFER',
      },
      _sum: { amount: true },
    })

    const incomeAmount = new Decimal(incomes._sum.amount?.toString() || '0')
    const expenseAmount = new Decimal(expenses._sum.amount?.toString() || '0')
    const transferInAmount = new Decimal(transfersIn._sum.amount?.toString() || '0')
    const transferOutAmount = new Decimal(transfersOut._sum.amount?.toString() || '0')

    // Balance = ingresos + transferencias entrantes - gastos - transferencias salientes
    return incomeAmount.plus(transferInAmount).minus(expenseAmount).minus(transferOutAmount)
  }

  /**
   * Recalcula el balance de una cuenta desde las transacciones y actualiza el campo amount.
   * Este es el método centralizado que debe llamarse después de cualquier operación de transacción.
   */
  async recalculateAndUpdateBalance(id: string, tx?: Prisma.TransactionClient): Promise<Decimal> {
    const client = tx || this.prisma

    // Get detailed breakdown for debugging
    const incomes = await client.transaction.aggregate({
      where: { sourceAccount: id, type: 'INCOME' },
      _sum: { amount: true },
      _count: true,
    })
    const expenses = await client.transaction.aggregate({
      where: { sourceAccount: id, type: 'EXPENSE' },
      _sum: { amount: true },
      _count: true,
    })

    console.log('[AccountRepository] Balance breakdown for account:', id, {
      incomes: { count: incomes._count, sum: incomes._sum.amount?.toString() || '0' },
      expenses: { count: expenses._count, sum: expenses._sum.amount?.toString() || '0' },
    })

    const newBalance = await this.calculateBalance(id, tx)

    // Get current balance before update
    const currentAccount = await client.account.findUnique({ where: { id } })
    const oldBalance = currentAccount?.amount?.toString() || '0'

    console.log('[AccountRepository] recalculateAndUpdateBalance:', {
      accountId: id,
      oldBalance,
      newBalance: newBalance.toString(),
    })

    await client.account.update({
      where: { id },
      data: { amount: newBalance },
    })

    return newBalance
  }
}
