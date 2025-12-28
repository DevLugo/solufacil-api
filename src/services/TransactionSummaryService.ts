import { Decimal } from 'decimal.js'
import type { PrismaClient, SourceType } from '@solufacil/database'

/**
 * Source type labels in Spanish
 */
const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  LOAN_GRANT: 'Préstamo otorgado',
  LOAN_GRANT_COMMISSION: 'Comisión préstamo',
  LOAN_CANCELLED_RESTORE: 'Préstamo cancelado',
  LOAN_PAYMENT_CASH: 'Pago efectivo',
  LOAN_PAYMENT_BANK: 'Pago banco',
  PAYMENT_COMMISSION: 'Comisión abono',
  TRANSFER_OUT: 'Transferencia saliente',
  TRANSFER_IN: 'Transferencia entrante',
  GASOLINE: 'Gasolina',
  GASOLINE_TOKA: 'Gasolina Toka',
  NOMINA_SALARY: 'Nómina',
  EXTERNAL_SALARY: 'Salario externo',
  VIATIC: 'Viáticos',
  TRAVEL_EXPENSES: 'Gastos viaje',
  FALCO_LOSS: 'Pérdida falco',
  FALCO_COMPENSATORY: 'Compensación falco',
  INITIAL_BALANCE: 'Balance inicial',
  BALANCE_ADJUSTMENT: 'Ajuste balance',
  // Nuevos tipos de gastos
  EMPLOYEE_EXPENSE: 'Gasto empleado',
  GENERAL_EXPENSE: 'Gasto general',
  CAR_PAYMENT: 'Pago vehículo',
  BANK_EXPENSE: 'Gasto bancario',
  OTHER_EXPENSE: 'Otro gasto',
  EXPENSE_REFUND: 'Devolución',
  // Ingresos especiales
  MONEY_INVESTMENT: 'Inversión',
  MULTA: 'Multa',
}

/**
 * Source types that are automatic (not manual expenses)
 */
const AUTOMATIC_SOURCE_TYPES: SourceType[] = [
  'LOAN_GRANT',
  'LOAN_GRANT_COMMISSION',
  'LOAN_CANCELLED_RESTORE',
  'LOAN_PAYMENT_CASH',
  'LOAN_PAYMENT_BANK',
  'PAYMENT_COMMISSION',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'INITIAL_BALANCE',
  'BALANCE_ADJUSTMENT',
]

/**
 * Manual expense source types (shown in Gastos section)
 */
const MANUAL_EXPENSE_TYPES: SourceType[] = [
  'GASOLINE',
  'GASOLINE_TOKA',
  'NOMINA_SALARY',
  'EXTERNAL_SALARY',
  'VIATIC',
  'TRAVEL_EXPENSES',
  'FALCO_LOSS',
  'FALCO_COMPENSATORY',
  'EMPLOYEE_EXPENSE',
  'GENERAL_EXPENSE',
  'CAR_PAYMENT',
  'BANK_EXPENSE',
  'OTHER_EXPENSE',
]

interface PaymentSummary {
  id: string
  borrowerName: string
  amount: Decimal
  commission: Decimal
  paymentMethod: 'CASH' | 'MONEY_TRANSFER'
  date: Date
}

interface ExpenseSummary {
  id: string
  source: string
  sourceLabel: string
  amount: Decimal
  date: Date
}

interface LoanGrantedSummary {
  id: string
  borrowerName: string
  amount: Decimal
  date: Date
}

interface LocalitySummary {
  locationKey: string
  localityName: string
  leaderName: string
  leaderId: string
  payments: PaymentSummary[]
  totalPayments: Decimal
  cashPayments: Decimal
  bankPayments: Decimal
  bankPaymentsFromClients: Decimal
  leaderCashToBank: Decimal
  totalPaymentCommissions: Decimal
  totalLoansGrantedCommissions: Decimal
  totalCommissions: Decimal
  paymentCount: number
  expenses: ExpenseSummary[]
  totalExpenses: Decimal
  loansGranted: LoanGrantedSummary[]
  totalLoansGranted: Decimal
  loansGrantedCount: number
  balanceEfectivo: Decimal
  balanceBanco: Decimal
  balance: Decimal
}

interface ExecutiveSummary {
  totalPaymentsReceived: Decimal
  totalCashPayments: Decimal
  totalBankPayments: Decimal
  totalPaymentCommissions: Decimal
  totalLoansGrantedCommissions: Decimal
  totalCommissions: Decimal
  totalExpenses: Decimal
  totalLoansGranted: Decimal
  paymentCount: number
  expenseCount: number
  loansGrantedCount: number
  netBalance: Decimal
}

export interface TransactionSummaryResponse {
  localities: LocalitySummary[]
  executiveSummary: ExecutiveSummary
}

export class TransactionSummaryService {
  constructor(private prisma: PrismaClient) {}

  async getSummaryByLocation(
    routeId: string,
    startDate: Date,
    endDate: Date
  ): Promise<TransactionSummaryResponse> {
    // Fetch all AccountEntry records for the route in the date range
    const entries = await this.prisma.accountEntry.findMany({
      where: {
        snapshotRouteId: routeId,
        entryDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        loan: {
          include: {
            borrowerRelation: {
              include: {
                personalDataRelation: true,
              },
            },
            leadRelation: {
              include: {
                personalDataRelation: {
                  include: {
                    addresses: {
                      include: {
                        locationRelation: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        loanPayment: {
          include: {
            loanRelation: {
              include: {
                borrowerRelation: {
                  include: {
                    personalDataRelation: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        entryDate: 'asc',
      },
    })

    // We need to get leader info - fetch separately for entries with snapshotLeadId
    const leaderIds = [...new Set(entries.map(e => e.snapshotLeadId).filter(Boolean))]
    const leaders = leaderIds.length > 0
      ? await this.prisma.employee.findMany({
          where: { id: { in: leaderIds } },
          include: {
            personalDataRelation: {
              include: {
                addresses: {
                  include: {
                    locationRelation: true,
                  },
                },
              },
            },
          },
        })
      : []

    const leaderMap = new Map(leaders.map(l => [l.id, l]))

    // Group entries by locality
    const grouped: Record<string, LocalitySummary> = {}

    for (const entry of entries) {
      // Get leader info from the entry's loan or from the snapshotLeadId
      const leaderId = entry.snapshotLeadId ||
        entry.loan?.lead ||
        entry.loanPayment?.loanRelation?.lead || ''

      const leader = leaderMap.get(leaderId) || entry.loan?.leadRelation

      const locationAddress = leader?.personalDataRelation?.addresses?.[0]
      const localityName = locationAddress?.locationRelation?.name || 'Sin localidad'
      const leaderName = leader?.personalDataRelation?.fullName || 'Sin líder'
      const locationKey = `${localityName}|${leaderName}`

      // Initialize locality if not exists
      if (!grouped[locationKey]) {
        grouped[locationKey] = {
          locationKey,
          localityName,
          leaderName,
          leaderId,
          payments: [],
          totalPayments: new Decimal(0),
          cashPayments: new Decimal(0),
          bankPayments: new Decimal(0),
          bankPaymentsFromClients: new Decimal(0),
          leaderCashToBank: new Decimal(0),
          totalPaymentCommissions: new Decimal(0),
          totalLoansGrantedCommissions: new Decimal(0),
          totalCommissions: new Decimal(0),
          paymentCount: 0,
          expenses: [],
          totalExpenses: new Decimal(0),
          loansGranted: [],
          totalLoansGranted: new Decimal(0),
          loansGrantedCount: 0,
          balanceEfectivo: new Decimal(0),
          balanceBanco: new Decimal(0),
          balance: new Decimal(0),
        }
      }

      const loc = grouped[locationKey]
      const amount = new Decimal(entry.amount.toString())

      // Process based on sourceType
      switch (entry.sourceType) {
        case 'LOAN_PAYMENT_CASH':
        case 'LOAN_PAYMENT_BANK': {
          // It's a loan payment
          const loanPayment = entry.loanPayment
          const paymentAmount = loanPayment
            ? new Decimal(loanPayment.amount.toString())
            : amount
          const commission = loanPayment
            ? new Decimal(loanPayment.comission?.toString() || '0')
            : new Decimal(0)

          const borrowerName = loanPayment?.loanRelation?.borrowerRelation?.personalDataRelation?.fullName ||
            entry.loan?.borrowerRelation?.personalDataRelation?.fullName ||
            'Sin nombre'

          const payment: PaymentSummary = {
            id: entry.id,
            borrowerName,
            amount: paymentAmount,
            commission,
            paymentMethod: entry.sourceType === 'LOAN_PAYMENT_CASH' ? 'CASH' : 'MONEY_TRANSFER',
            date: entry.entryDate,
          }

          loc.payments.push(payment)
          loc.totalPayments = loc.totalPayments.plus(paymentAmount)
          loc.paymentCount++

          if (entry.sourceType === 'LOAN_PAYMENT_CASH') {
            loc.cashPayments = loc.cashPayments.plus(paymentAmount)
          } else {
            loc.bankPayments = loc.bankPayments.plus(paymentAmount)
            loc.bankPaymentsFromClients = loc.bankPaymentsFromClients.plus(paymentAmount)
          }
          break
        }

        case 'PAYMENT_COMMISSION': {
          // Commission expense for payment
          loc.totalPaymentCommissions = loc.totalPaymentCommissions.plus(amount)
          break
        }

        case 'LOAN_GRANT_COMMISSION': {
          // Commission expense for granting loan
          loc.totalLoansGrantedCommissions = loc.totalLoansGrantedCommissions.plus(amount)
          break
        }

        case 'LOAN_GRANT': {
          // Loan granted
          const loanAmount = entry.loan?.amountGived
            ? new Decimal(entry.loan.amountGived.toString())
            : amount

          const loanGranted: LoanGrantedSummary = {
            id: entry.id,
            borrowerName:
              entry.loan?.borrowerRelation?.personalDataRelation?.fullName || 'Sin nombre',
            amount: loanAmount,
            date: entry.entryDate,
          }

          loc.loansGranted.push(loanGranted)
          loc.totalLoansGranted = loc.totalLoansGranted.plus(loanAmount)
          loc.loansGrantedCount++
          break
        }

        case 'TRANSFER_OUT': {
          // Cash transferred to bank (only count DEBIT side to avoid double counting)
          loc.cashPayments = loc.cashPayments.minus(amount)
          loc.bankPayments = loc.bankPayments.plus(amount)
          loc.leaderCashToBank = loc.leaderCashToBank.plus(amount)
          break
        }

        case 'TRANSFER_IN': {
          // Skip - we already handled this via TRANSFER_OUT
          break
        }

        default: {
          // Check if it's a manual expense
          if (MANUAL_EXPENSE_TYPES.includes(entry.sourceType) && entry.entryType === 'DEBIT') {
            const expense: ExpenseSummary = {
              id: entry.id,
              source: entry.sourceType,
              sourceLabel: SOURCE_TYPE_LABELS[entry.sourceType] || entry.sourceType,
              amount,
              date: entry.entryDate,
            }

            loc.expenses.push(expense)
            loc.totalExpenses = loc.totalExpenses.plus(amount)
          }
          break
        }
      }
    }

    // Calculate balances for each locality
    for (const loc of Object.values(grouped)) {
      // Total commissions = payment commissions + loan granted commissions
      loc.totalCommissions = loc.totalPaymentCommissions.plus(loc.totalLoansGrantedCommissions)

      loc.balanceEfectivo = loc.cashPayments
        .minus(loc.totalCommissions)
        .minus(loc.totalLoansGranted)
        .minus(loc.totalExpenses)
      loc.balanceBanco = loc.bankPayments
      loc.balance = loc.balanceEfectivo.plus(loc.balanceBanco)
    }

    // Sort by total payments (descending)
    const localities = Object.values(grouped).sort((a, b) =>
      b.totalPayments.minus(a.totalPayments).toNumber()
    )

    // Calculate executive summary
    const executiveSummary = localities.reduce<ExecutiveSummary>(
      (acc, loc) => ({
        totalPaymentsReceived: acc.totalPaymentsReceived.plus(loc.totalPayments),
        totalCashPayments: acc.totalCashPayments.plus(loc.cashPayments),
        totalBankPayments: acc.totalBankPayments.plus(loc.bankPayments),
        totalPaymentCommissions: acc.totalPaymentCommissions.plus(loc.totalPaymentCommissions),
        totalLoansGrantedCommissions: acc.totalLoansGrantedCommissions.plus(loc.totalLoansGrantedCommissions),
        totalCommissions: acc.totalCommissions.plus(loc.totalCommissions),
        totalExpenses: acc.totalExpenses.plus(loc.totalExpenses),
        totalLoansGranted: acc.totalLoansGranted.plus(loc.totalLoansGranted),
        paymentCount: acc.paymentCount + loc.paymentCount,
        expenseCount: acc.expenseCount + loc.expenses.length,
        loansGrantedCount: acc.loansGrantedCount + loc.loansGrantedCount,
        netBalance: acc.netBalance.plus(loc.balance),
      }),
      {
        totalPaymentsReceived: new Decimal(0),
        totalCashPayments: new Decimal(0),
        totalBankPayments: new Decimal(0),
        totalPaymentCommissions: new Decimal(0),
        totalLoansGrantedCommissions: new Decimal(0),
        totalCommissions: new Decimal(0),
        totalExpenses: new Decimal(0),
        totalLoansGranted: new Decimal(0),
        paymentCount: 0,
        expenseCount: 0,
        loansGrantedCount: 0,
        netBalance: new Decimal(0),
      }
    )

    return {
      localities,
      executiveSummary,
    }
  }
}
