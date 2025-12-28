import type { PrismaClient, Account, AccountType, Prisma } from '@solufacil/database'
import { Decimal } from 'decimal.js'

/**
 * AccountRepository - Gestión de cuentas
 *
 * ===============================================================
 * IMPORTANTE: NUEVA ARQUITECTURA DE BALANCE
 * ===============================================================
 *
 * A partir de la migración a ledger-based balance, los métodos
 * addToBalance() y subtractFromBalance() están DEPRECADOS.
 *
 * Usar BalanceService.createEntry() en su lugar:
 *
 * ```typescript
 * const balanceService = new BalanceService(prisma)
 *
 * // Para sumar al balance (CREDIT):
 * await balanceService.createEntry({
 *   accountId,
 *   entryType: 'CREDIT',
 *   amount: 100,
 *   sourceType: 'LOAN_PAYMENT_CASH',
 * }, tx)
 *
 * // Para restar del balance (DEBIT):
 * await balanceService.createEntry({
 *   accountId,
 *   entryType: 'DEBIT',
 *   amount: 100,
 *   sourceType: 'LOAN_GRANT',
 * }, tx)
 * ```
 *
 * El campo Account.amount es un cache materializado que se actualiza
 * automáticamente con cada AccountEntry creado.
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
   * @deprecated Use BalanceService.createEntry() with entryType='CREDIT' instead.
   *
   * Este método se mantiene para compatibilidad con código legacy
   * (TransactionService.update/delete para transacciones antiguas).
   *
   * NO usar en código nuevo.
   */
  async addToBalance(id: string, amount: Decimal, tx?: Prisma.TransactionClient): Promise<Decimal> {
    console.warn('[DEPRECATED] AccountRepository.addToBalance() - Use BalanceService.createEntry() instead')

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
   * @deprecated Use BalanceService.createEntry() with entryType='DEBIT' instead.
   *
   * Este método se mantiene para compatibilidad con código legacy
   * (TransactionService.update/delete para transacciones antiguas).
   *
   * NO usar en código nuevo.
   */
  async subtractFromBalance(id: string, amount: Decimal, tx?: Prisma.TransactionClient): Promise<Decimal> {
    console.warn('[DEPRECATED] AccountRepository.subtractFromBalance() - Use BalanceService.createEntry() instead')

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
