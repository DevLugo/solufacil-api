import { GraphQLError } from 'graphql'
import { Decimal } from 'decimal.js'
import type { PrismaClient, TransactionType, SourceType } from '@solufacil/database'
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
  description?: string
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
      // System-generated expenses
      case 'LOAN_GRANTED': return 'LOAN_GRANT'
      case 'LOAN_GRANTED_COMISSION': return 'LOAN_GRANT_COMMISSION'
      case 'LOAN_PAYMENT_COMISSION': return 'PAYMENT_COMMISSION'
      case 'FALCO_LOSS': return 'FALCO_LOSS'
      case 'FALCO_COMPENSATORY': return 'FALCO_COMPENSATORY'

      // Direct mappings (same name)
      case 'GASOLINE': return 'GASOLINE'
      case 'GASOLINE_TOKA': return 'GASOLINE_TOKA'
      case 'NOMINA_SALARY': return 'NOMINA_SALARY'
      case 'EXTERNAL_SALARY': return 'EXTERNAL_SALARY'
      case 'VIATIC': return 'VIATIC'
      case 'TRAVEL_EXPENSES': return 'TRAVEL_EXPENSES'
      case 'ASSET_ACQUISITION': return 'ASSET_ACQUISITION'
      case 'CAR_PAYMENT': return 'CAR_PAYMENT'
      case 'EMPLOYEE_EXPENSE': return 'EMPLOYEE_EXPENSE'
      case 'GENERAL_EXPENSE': return 'GENERAL_EXPENSE'
      case 'BANK_EXPENSE': return 'BANK_EXPENSE'
      case 'OTHER_EXPENSE': return 'OTHER_EXPENSE'

      // Frontend expense types mapped to SourceType categories
      case 'OTRO': return 'OTHER_EXPENSE'
      case 'ACCOMMODATION': return 'VIATIC'
      case 'CASETA': return 'TRAVEL_EXPENSES'
      case 'VEHICULE_MAINTENANCE': return 'CAR_PAYMENT'
      case 'LAVADO_DE_AUTO': return 'CAR_PAYMENT'
      case 'IMSS_INFONAVIT': return 'EMPLOYEE_EXPENSE'
      case 'POSADA': return 'EMPLOYEE_EXPENSE'
      case 'REGALOS_LIDERES': return 'EMPLOYEE_EXPENSE'
      case 'AGUINALDO': return 'NOMINA_SALARY'
      case 'PAPELERIA': return 'GENERAL_EXPENSE'
      case 'HOUSE_RENT': return 'GENERAL_EXPENSE'

      default: return 'BALANCE_ADJUSTMENT'
    }
  }
  return 'BALANCE_ADJUSTMENT'
}

export class TransactionService {
  private accountRepository: AccountRepository
  private balanceService: BalanceService

  constructor(private prisma: PrismaClient) {
    this.accountRepository = new AccountRepository(prisma)
    this.balanceService = new BalanceService(prisma)
  }

  async findById(id: string) {
    const entry = await this.prisma.accountEntry.findUnique({
      where: { id },
      include: {
        account: true,
        loan: { include: { borrowerRelation: { include: { personalDataRelation: true } } } },
        loanPayment: true,
      },
    })

    if (!entry) {
      throw new GraphQLError('Entry not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    return this.mapEntryToTransaction(entry)
  }

  async findMany(options?: {
    type?: TransactionType
    routeId?: string
    leadId?: string
    accountId?: string
    fromDate?: Date
    toDate?: Date
    limit?: number
    offset?: number
  }) {
    const where: any = {}

    // Map TransactionType to SourceTypes
    const sourceTypes = options?.type
      ? this.getSourceTypesForTransactionType(options.type)
      : []

    // If filtering by specific leadId, use simple snapshotLeadId filter
    // If leadId is explicitly null/undefined but routeId is present, filter by route
    if (options?.leadId) {
      // Filter by specific lead
      where.snapshotLeadId = options.leadId

      if (sourceTypes.length > 0) {
        where.sourceType = { in: sourceTypes }
      }
    } else if (options?.routeId) {
      // Primary filter: use snapshotRouteId for entries that have it
      // Fallback: for legacy entries without snapshotRouteId, use account/lead based filtering
      const routeConditions: any[] = [
        // Entries with snapshotRouteId set (new entries after migration)
        { snapshotRouteId: options.routeId },
      ]

      // Fallback for legacy entries without snapshotRouteId
      // Get leaders and accounts for this route
      const [leadersInRoute, routeAccounts] = await Promise.all([
        this.prisma.employee.findMany({
          where: { routes: { some: { id: options.routeId } } },
          select: { id: true },
        }),
        this.prisma.account.findMany({
          where: { routes: { some: { id: options.routeId } } },
          select: { id: true },
        }),
      ])

      const leaderIdsInRoute = leadersInRoute.map(l => l.id)
      const routeAccountIds = routeAccounts.map(a => a.id)

      // Legacy fallback conditions (only for entries without snapshotRouteId)
      routeConditions.push(
        // Entries with loan where lead is in route (legacy)
        {
          snapshotRouteId: { equals: '' },
          loan: {
            leadRelation: {
              routes: { some: { id: options.routeId } },
            },
          },
        },
        // Entries without loan but with snapshotLeadId in route (legacy)
        {
          snapshotRouteId: { equals: '' },
          loan: { is: null },
          snapshotLeadId: { in: leaderIdsInRoute },
        },
        // General expenses on route accounts (legacy - no loan, empty snapshotLeadId)
        {
          snapshotRouteId: { equals: '' },
          loan: { is: null },
          snapshotLeadId: { equals: '' },
          accountId: { in: routeAccountIds },
        },
      )

      // If filtering by sourceTypes, add to each OR condition
      if (sourceTypes.length > 0) {
        where.AND = [
          { sourceType: { in: sourceTypes } },
          { OR: routeConditions },
        ]
      } else {
        where.OR = routeConditions
      }
    } else if (sourceTypes.length > 0) {
      where.sourceType = { in: sourceTypes }
    }

    if (options?.accountId) {
      // Append to existing AND or create new one
      const accountCondition = {
        OR: [
          { accountId: options.accountId },
          { destinationAccountId: options.accountId },
        ],
      }
      if (where.AND) {
        where.AND.push(accountCondition)
      } else {
        where.AND = [accountCondition]
      }
    }

    if (options?.fromDate || options?.toDate) {
      const dateCondition: any = { entryDate: {} }
      if (options?.fromDate) {
        dateCondition.entryDate.gte = options.fromDate
      }
      if (options?.toDate) {
        dateCondition.entryDate.lte = options.toDate
      }
      if (where.AND) {
        where.AND.push(dateCondition)
      } else {
        where.AND = [dateCondition]
      }
    }

    const [entries, totalCount] = await Promise.all([
      this.prisma.accountEntry.findMany({
        where,
        take: options?.limit ?? 50,
        skip: options?.offset ?? 0,
        orderBy: { entryDate: 'desc' },
        include: {
          account: { select: { id: true, name: true, type: true } },
          loan: {
            select: {
              id: true,
              amountGived: true,
              borrower: true,
              borrowerRelation: { select: { id: true, personalData: true, personalDataRelation: { select: { id: true, fullName: true } } } },
            },
          },
          loanPayment: { select: { id: true, amount: true, comission: true, paymentMethod: true } },
        },
      }),
      this.prisma.accountEntry.count({ where }),
    ])

    const transactions = await Promise.all(entries.map(entry => this.mapEntryToTransaction(entry)))
    return { transactions, totalCount }
  }

  private getSourceTypesForTransactionType(type: TransactionType): SourceType[] {
    switch (type) {
      case 'INCOME':
        return ['LOAN_PAYMENT_CASH', 'LOAN_PAYMENT_BANK']
      case 'EXPENSE':
        return [
          'LOAN_GRANT', 'LOAN_GRANT_COMMISSION', 'PAYMENT_COMMISSION',
          'GASOLINE', 'GASOLINE_TOKA', 'NOMINA_SALARY', 'EXTERNAL_SALARY',
          'VIATIC', 'TRAVEL_EXPENSES', 'EMPLOYEE_EXPENSE', 'GENERAL_EXPENSE',
          'CAR_PAYMENT', 'BANK_EXPENSE', 'OTHER_EXPENSE', 'FALCO_LOSS', 'ASSET_ACQUISITION',
          'BALANCE_ADJUSTMENT'
        ]
      case 'TRANSFER':
        return ['TRANSFER_OUT', 'TRANSFER_IN']
      default:
        return []
    }
  }

  private async mapEntryToTransaction(entry: any) {
    const { type, incomeSource, expenseSource } = this.mapSourceTypeToLegacy(entry.sourceType)

    // Fetch lead if we have snapshot ID
    let leadRelation = null

    if (entry.snapshotLeadId) {
      leadRelation = await this.prisma.employee.findUnique({
        where: { id: entry.snapshotLeadId },
        select: { id: true, personalData: true, personalDataRelation: { select: { id: true, fullName: true } } },
      })
    }

    // Get route from lead's current routes
    let routeRelation = null
    if (leadRelation) {
      const leadWithRoutes = await this.prisma.employee.findUnique({
        where: { id: entry.snapshotLeadId },
        select: { routes: { select: { id: true, name: true }, take: 1 } },
      })
      routeRelation = leadWithRoutes?.routes?.[0] || null
    }

    // Fetch destination account if it's a transfer
    let destinationAccountRelation = null
    if (entry.destinationAccountId) {
      destinationAccountRelation = await this.prisma.account.findUnique({
        where: { id: entry.destinationAccountId },
        select: { id: true, name: true, type: true },
      })
    }

    return {
      id: entry.id,
      amount: entry.amount,
      date: entry.entryDate,
      type,
      incomeSource,
      expenseSource,
      description: entry.description,
      profitAmount: entry.profitAmount,
      returnToCapital: entry.returnToCapital,
      snapshotLeadId: entry.snapshotLeadId,
      sourceAccount: entry.accountId,
      destinationAccount: entry.destinationAccountId,
      loan: entry.loanId,
      loanPayment: entry.loanPaymentId,
      route: routeRelation?.id || null,
      lead: entry.snapshotLeadId,
      createdAt: entry.createdAt,
      updatedAt: entry.createdAt,
      sourceAccountRelation: entry.account,
      destinationAccountRelation,
      loanRelation: entry.loan,
      loanPaymentRelation: entry.loanPayment,
      routeRelation,
      leadRelation,
    }
  }

  private mapSourceTypeToLegacy(sourceType: SourceType): { type: TransactionType; incomeSource?: string; expenseSource?: string } {
    switch (sourceType) {
      case 'LOAN_PAYMENT_CASH': return { type: 'INCOME', incomeSource: 'CASH_LOAN_PAYMENT' }
      case 'LOAN_PAYMENT_BANK': return { type: 'INCOME', incomeSource: 'BANK_LOAN_PAYMENT' }
      case 'LOAN_GRANT': return { type: 'EXPENSE', expenseSource: 'LOAN_GRANTED' }
      case 'LOAN_GRANT_COMMISSION': return { type: 'EXPENSE', expenseSource: 'LOAN_GRANTED_COMISSION' }
      case 'PAYMENT_COMMISSION': return { type: 'EXPENSE', expenseSource: 'LOAN_PAYMENT_COMISSION' }
      case 'GASOLINE': return { type: 'EXPENSE', expenseSource: 'GASOLINE' }
      case 'GASOLINE_TOKA': return { type: 'EXPENSE', expenseSource: 'GASOLINE_TOKA' }
      case 'NOMINA_SALARY': return { type: 'EXPENSE', expenseSource: 'NOMINA_SALARY' }
      case 'EXTERNAL_SALARY': return { type: 'EXPENSE', expenseSource: 'EXTERNAL_SALARY' }
      case 'VIATIC': return { type: 'EXPENSE', expenseSource: 'VIATIC' }
      case 'TRAVEL_EXPENSES': return { type: 'EXPENSE', expenseSource: 'TRAVEL_EXPENSES' }
      case 'EMPLOYEE_EXPENSE': return { type: 'EXPENSE', expenseSource: 'EMPLOYEE_EXPENSE' }
      case 'GENERAL_EXPENSE': return { type: 'EXPENSE', expenseSource: 'GENERAL_EXPENSE' }
      case 'CAR_PAYMENT': return { type: 'EXPENSE', expenseSource: 'CAR_PAYMENT' }
      case 'BANK_EXPENSE': return { type: 'EXPENSE', expenseSource: 'BANK_EXPENSE' }
      case 'OTHER_EXPENSE': return { type: 'EXPENSE', expenseSource: 'OTHER_EXPENSE' }
      case 'FALCO_LOSS': return { type: 'EXPENSE', expenseSource: 'FALCO_LOSS' }
      case 'FALCO_COMPENSATORY': return { type: 'INCOME', incomeSource: 'FALCO_COMPENSATORY' }
      case 'ASSET_ACQUISITION': return { type: 'EXPENSE', expenseSource: 'ASSET_ACQUISITION' }
      case 'TRANSFER_OUT':
      case 'TRANSFER_IN': return { type: 'TRANSFER' }
      default: return { type: 'EXPENSE', expenseSource: 'OTRO' }
    }
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
        // Guardar expenseSource original en description para recuperarlo al leer
        // Formato: "EXPENSE_TYPE:XXX" o "EXPENSE_TYPE:XXX|Notas del usuario"
        const expenseDescription = input.expenseSource
          ? input.description
            ? `EXPENSE_TYPE:${input.expenseSource}|${input.description}`
            : `EXPENSE_TYPE:${input.expenseSource}`
          : input.description || ''

        await balanceService.createEntry({
          accountId: input.sourceAccountId,
          entryType: 'DEBIT',
          amount,
          sourceType,
          entryDate: input.date,
          loanId: input.loanId,
          snapshotLeadId: input.leadId || '',
          snapshotRouteId: input.routeId || '',
          description: expenseDescription,
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
   * Update an AccountEntry and adjust balances accordingly.
   */
  async update(id: string, input: UpdateTransactionInput) {
    // Get existing entry
    const existingEntry = await this.prisma.accountEntry.findUnique({
      where: { id },
    })
    if (!existingEntry) {
      throw new GraphQLError('Entry not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Validate new account if changing
    if (input.sourceAccountId) {
      const accountExists = await this.accountRepository.exists(input.sourceAccountId)
      if (!accountExists) {
        throw new GraphQLError('Source account not found', {
          extensions: { code: 'NOT_FOUND' },
        })
      }
    }

    const oldAccountId = existingEntry.accountId
    const newAccountId = input.sourceAccountId || oldAccountId
    const oldAmount = new Decimal(existingEntry.amount.toString())
    const newAmount = input.amount ? new Decimal(input.amount) : oldAmount
    const isDebit = existingEntry.entryType === 'DEBIT'

    return this.prisma.$transaction(async (tx) => {
      // Update the entry
      const updatedEntry = await tx.accountEntry.update({
        where: { id },
        data: {
          amount: newAmount,
          accountId: newAccountId,
          description: input.description || existingEntry.description,
        },
      })

      // Adjust balances
      if (newAccountId !== oldAccountId) {
        // Account changed - reverse from old, apply to new
        if (isDebit) {
          // DEBIT had subtracted from balance, add it back to old account
          await this.accountRepository.addToBalance(oldAccountId, oldAmount, tx)
          // Subtract from new account
          await this.accountRepository.subtractFromBalance(newAccountId, newAmount, tx)
        } else {
          // CREDIT had added to balance, subtract from old account
          await this.accountRepository.subtractFromBalance(oldAccountId, oldAmount, tx)
          // Add to new account
          await this.accountRepository.addToBalance(newAccountId, newAmount, tx)
        }
      } else if (!oldAmount.equals(newAmount)) {
        // Only amount changed, apply difference
        const difference = newAmount.minus(oldAmount)
        if (isDebit) {
          // DEBIT: larger amount = more subtracted
          await this.accountRepository.subtractFromBalance(newAccountId, difference, tx)
        } else {
          // CREDIT: larger amount = more added
          await this.accountRepository.addToBalance(newAccountId, difference, tx)
        }
      }

      return this.mapEntryToTransaction(updatedEntry)
    })
  }

  /**
   * Delete an AccountEntry and reverse its balance effect.
   */
  async delete(id: string) {
    // Get existing entry
    const existingEntry = await this.prisma.accountEntry.findUnique({
      where: { id },
    })
    if (!existingEntry) {
      throw new GraphQLError('Entry not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const accountId = existingEntry.accountId
    const amount = new Decimal(existingEntry.amount.toString())
    const isDebit = existingEntry.entryType === 'DEBIT'

    return this.prisma.$transaction(async (tx) => {
      // Delete the entry
      await tx.accountEntry.delete({
        where: { id },
      })

      // Reverse the balance effect
      if (isDebit) {
        // DEBIT had subtracted from balance, add it back
        await this.accountRepository.addToBalance(accountId, amount, tx)
      } else {
        // CREDIT had added to balance, subtract it
        await this.accountRepository.subtractFromBalance(accountId, amount, tx)
      }

      // Handle transfer pair: if this was TRANSFER_OUT, also delete the matching TRANSFER_IN
      if (existingEntry.sourceType === 'TRANSFER_OUT' && existingEntry.destinationAccountId) {
        const transferInEntry = await tx.accountEntry.findFirst({
          where: {
            sourceType: 'TRANSFER_IN',
            accountId: existingEntry.destinationAccountId,
            amount: amount,
            entryDate: existingEntry.entryDate,
          },
        })
        if (transferInEntry) {
          await tx.accountEntry.delete({ where: { id: transferInEntry.id } })
          await this.accountRepository.subtractFromBalance(existingEntry.destinationAccountId, amount, tx)
        }
      }

      return true
    })
  }
}
