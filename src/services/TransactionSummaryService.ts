import { Decimal } from 'decimal.js'
import type { PrismaClient } from '@solufacil/database'

/**
 * Expense source labels in Spanish
 */
const EXPENSE_SOURCE_LABELS: Record<string, string> = {
  VIATIC: 'Viáticos',
  GASOLINE: 'Gasolina',
  ACCOMMODATION: 'Hospedaje',
  NOMINA_SALARY: 'Nómina',
  EXTERNAL_SALARY: 'Salario externo',
  VEHICLE_MAINTENANCE: 'Mantenimiento vehículo',
  LOAN_GRANTED: 'Préstamo otorgado',
  LOAN_GRANTED_COMISSION: 'Comisión préstamo',
  LOAN_PAYMENT_COMISSION: 'Comisión abono',
  LEAD_COMISSION: 'Comisión líder',
  LEAD_EXPENSE: 'Gasto líder',
  OTHER: 'Otro',
}

/**
 * Expense sources that are automatically created by the system
 * These should NOT appear in the Gastos section (they are shown elsewhere)
 */
const AUTOMATIC_EXPENSE_SOURCES = [
  'LOAN_GRANTED', // Goes to "Colocado"
  'LOAN_GRANTED_COMISSION', // Part of commissions
  'LOAN_PAYMENT_COMISSION', // Part of commissions
  'LOAN_CANCELLED_ADJUSTMENT', // System adjustments
  'LOAN_CANCELLED_BANK_REVERSAL', // System reversals
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
  // Breakdown of bank payments:
  // - bankPaymentsFromClients: Pagos que clientes hicieron por transferencia (BANK_LOAN_PAYMENT)
  // - leaderCashToBank: Efectivo que el líder transfirió al banco (TRANSFER)
  bankPaymentsFromClients: Decimal
  leaderCashToBank: Decimal
  // Comisiones por pagos de abonos (lo que se paga al líder por cobrar)
  totalPaymentCommissions: Decimal
  // Comisiones por otorgar préstamos (lo que se paga al líder por colocar)
  totalLoansGrantedCommissions: Decimal
  // Total de comisiones (suma de ambos tipos)
  totalCommissions: Decimal
  paymentCount: number
  expenses: ExpenseSummary[]
  totalExpenses: Decimal
  loansGranted: LoanGrantedSummary[]
  totalLoansGranted: Decimal
  loansGrantedCount: number
  // Calculated balances
  // balanceEfectivo = cashPayments - totalCommissions - totalLoansGranted - totalExpenses
  balanceEfectivo: Decimal
  // balanceBanco = bankPayments (no expenses tracked separately for bank)
  balanceBanco: Decimal
  // balance = balanceEfectivo + balanceBanco (total)
  balance: Decimal
}

interface ExecutiveSummary {
  totalPaymentsReceived: Decimal
  totalCashPayments: Decimal
  totalBankPayments: Decimal
  // Comisiones por pagos de abonos
  totalPaymentCommissions: Decimal
  // Comisiones por otorgar préstamos
  totalLoansGrantedCommissions: Decimal
  // Total de comisiones (suma de ambos tipos)
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
    // Fetch all transactions for the route in the date range
    const transactions = await this.prisma.transaction.findMany({
      where: {
        route: routeId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
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
        loanPaymentRelation: true,
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
        // Include account relations to know destination type
        sourceAccountRelation: true,
        destinationAccountRelation: true,
      },
      orderBy: {
        date: 'asc',
      },
    })

    // Group transactions by locality
    const grouped: Record<string, LocalitySummary> = {}

    for (const tx of transactions) {
      const locationAddress = tx.leadRelation?.personalDataRelation?.addresses?.[0]
      const localityName = locationAddress?.locationRelation?.name || 'Sin localidad'
      const leaderName = tx.leadRelation?.personalDataRelation?.fullName || 'Sin líder'
      const leaderId = tx.lead || ''
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
      const amount = new Decimal(tx.amount.toString())

      // Process based on transaction type
      if (tx.type === 'INCOME') {
        // Check if it's a loan payment (abono)
        if (tx.loanPaymentRelation && tx.incomeSource?.includes('LOAN_PAYMENT')) {
          const paymentAmount = new Decimal(tx.loanPaymentRelation.amount.toString())
          const commission = new Decimal(tx.loanPaymentRelation.comission?.toString() || '0')

          const payment: PaymentSummary = {
            id: tx.id,
            borrowerName:
              tx.loanRelation?.borrowerRelation?.personalDataRelation?.fullName || 'Sin nombre',
            amount: paymentAmount,
            commission,
            paymentMethod: tx.loanPaymentRelation.paymentMethod as 'CASH' | 'MONEY_TRANSFER',
            date: tx.date,
          }

          loc.payments.push(payment)
          loc.totalPayments = loc.totalPayments.plus(paymentAmount)
          // Commission is an EXPENSE, not income - track it separately (comisión por cobrar abonos)
          loc.totalPaymentCommissions = loc.totalPaymentCommissions.plus(commission)
          loc.paymentCount++

          // Track cash/bank distribution based on incomeSource
          // CASH_LOAN_PAYMENT → goes to cash account initially
          // BANK_LOAN_PAYMENT → goes directly to bank account (from client transfer)
          if (tx.incomeSource === 'CASH_LOAN_PAYMENT') {
            loc.cashPayments = loc.cashPayments.plus(paymentAmount)
          } else if (tx.incomeSource === 'BANK_LOAN_PAYMENT') {
            loc.bankPayments = loc.bankPayments.plus(paymentAmount)
            loc.bankPaymentsFromClients = loc.bankPaymentsFromClients.plus(paymentAmount)
          }
        }
      } else if (tx.type === 'TRANSFER') {
        // TRANSFER transactions represent cash that the leader moved to the bank
        // This reduces cashPayments and increases bankPayments
        loc.cashPayments = loc.cashPayments.minus(amount)
        loc.bankPayments = loc.bankPayments.plus(amount)
        loc.leaderCashToBank = loc.leaderCashToBank.plus(amount)
      } else if (tx.type === 'EXPENSE') {
        // Check if it's a loan granted commission (comisión por otorgar préstamo)
        if (tx.expenseSource === 'LOAN_GRANTED_COMISSION') {
          loc.totalLoansGrantedCommissions = loc.totalLoansGrantedCommissions.plus(amount)
        }
        // Check if it's a loan granted (Colocado)
        else if (tx.expenseSource === 'LOAN_GRANTED') {
          const loanAmount = tx.loanRelation?.amountGived
            ? new Decimal(tx.loanRelation.amountGived.toString())
            : amount

          const loanGranted: LoanGrantedSummary = {
            id: tx.id,
            borrowerName:
              tx.loanRelation?.borrowerRelation?.personalDataRelation?.fullName || 'Sin nombre',
            amount: loanAmount,
            date: tx.date,
          }

          loc.loansGranted.push(loanGranted)
          loc.totalLoansGranted = loc.totalLoansGranted.plus(loanAmount)
          loc.loansGrantedCount++
        } else if (!AUTOMATIC_EXPENSE_SOURCES.includes(tx.expenseSource || '')) {
          // Regular expense (exclude automatic system expenses)
          const expense: ExpenseSummary = {
            id: tx.id,
            source: tx.expenseSource || 'OTHER',
            sourceLabel:
              EXPENSE_SOURCE_LABELS[tx.expenseSource || 'OTHER'] || tx.expenseSource || 'Otro',
            amount,
            date: tx.date,
          }

          loc.expenses.push(expense)
          loc.totalExpenses = loc.totalExpenses.plus(amount)
        }
        // Note: LOAN_PAYMENT_COMISSION is excluded as it's already tracked via loanPaymentRelation.comission
        // LOAN_GRANTED_COMISSION is now explicitly tracked in totalLoansGrantedCommissions
      }
    }

    // Calculate balances for each locality
    // First, calculate total commissions (payment commissions + loan granted commissions)
    // balanceEfectivo = cashPayments - totalCommissions - totalLoansGranted - totalExpenses
    // balanceBanco = bankPayments (no separate expenses for bank)
    // balance = balanceEfectivo + balanceBanco (total)
    // Commissions are a cost/expense that reduces our cash balance (paid to leaders)
    for (const loc of Object.values(grouped)) {
      // Total commissions = comisiones por abonos + comisiones por otorgar préstamos
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
