import type { PrismaClient, Account, AccountType, Prisma } from '@solufacil/database'
import { Decimal } from 'decimal.js'

/**
 * AccountRepository - Gestión de cuentas y balances
 *
 * ===============================================================
 * IMPORTANTE: POLÍTICA DE BALANCE DE CUENTAS
 * ===============================================================
 *
 * El campo `amount` representa el balance actual de la cuenta.
 * Se actualiza incrementalmente con cada transacción.
 *
 * Métodos para actualizar balance:
 * - `addToBalance(id, amount)`: Suma al balance (para INCOME, TRANSFER entrante)
 * - `subtractFromBalance(id, amount)`: Resta del balance (para EXPENSE, TRANSFER saliente)
 *
 * Flujo correcto:
 * ```typescript
 * // Después de crear una transacción EXPENSE:
 * await accountRepository.subtractFromBalance(accountId, amount, tx)
 *
 * // Después de crear una transacción INCOME:
 * await accountRepository.addToBalance(accountId, amount, tx)
 * ```
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
   * Obtiene el balance actual de la cuenta (campo `amount` almacenado).
   */
  async getBalance(id: string): Promise<Decimal> {
    const account = await this.prisma.account.findUnique({ where: { id } })
    return new Decimal(account?.amount?.toString() || '0')
  }

  /**
   * Suma un monto al balance de la cuenta.
   * Usar para: INCOME, TRANSFER entrante
   */
  async addToBalance(id: string, amount: Decimal, tx?: Prisma.TransactionClient): Promise<Decimal> {
    const client = tx || this.prisma

    const account = await client.account.update({
      where: { id },
      data: {
        amount: { increment: amount },
      },
    })

    return new Decimal(account.amount.toString())
  }

  /**
   * Resta un monto del balance de la cuenta.
   * Usar para: EXPENSE, TRANSFER saliente
   */
  async subtractFromBalance(id: string, amount: Decimal, tx?: Prisma.TransactionClient): Promise<Decimal> {
    const client = tx || this.prisma

    const account = await client.account.update({
      where: { id },
      data: {
        amount: { decrement: amount },
      },
    })

    return new Decimal(account.amount.toString())
  }

  /**
   * @deprecated Use addToBalance or subtractFromBalance instead.
   * Este método se mantiene temporalmente para compatibilidad pero NO debe usarse.
   */
  async recalculateAndUpdateBalance(id: string, tx?: Prisma.TransactionClient): Promise<Decimal> {
    console.warn('[AccountRepository] DEPRECATED: recalculateAndUpdateBalance called. Use addToBalance/subtractFromBalance instead.')
    const client = tx || this.prisma
    const account = await client.account.findUnique({ where: { id } })
    return new Decimal(account?.amount?.toString() || '0')
  }
}
