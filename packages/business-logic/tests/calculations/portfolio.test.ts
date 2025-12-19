import { describe, it, expect } from 'vitest'
import {
  isActiveLoan,
  countPaymentsInWeek,
  isInCarteraVencida,
  exitedCarteraVencida,
  calculateCVStatus,
  isNewClient,
  isFinishedWithoutRenewal,
  isRenewalInPeriod,
  isNewClientInPeriod,
  calculateTrend,
  calculateClientBalance,
  calculateRenovationKPIs,
  countClientsStatus,
} from '../../src/calculations/portfolio'
import { getActiveWeekRange, getPreviousWeek } from '../../src/calculations/active-week'
import type { LoanForPortfolio, PaymentForCV, WeekRange } from '../../src/types/portfolio'

// Helper to create test data
function createLoan(overrides: Partial<LoanForPortfolio> = {}): LoanForPortfolio {
  return {
    id: 'loan-1',
    pendingAmountStored: 1000,
    signDate: new Date('2024-01-01'),
    finishedDate: null,
    renewedDate: null,
    badDebtDate: null,
    excludedByCleanup: null,
    previousLoan: null,
    ...overrides,
  }
}

function createPayment(receivedAt: Date, amount: number = 300): PaymentForCV {
  return {
    id: `payment-${Math.random()}`,
    receivedAt,
    amount,
  }
}

describe('Portfolio Calculations', () => {
  describe('isActiveLoan', () => {
    it('returns true for active loan with pending amount', () => {
      const loan = createLoan({ pendingAmountStored: 1000 })
      expect(isActiveLoan(loan)).toBe(true)
    })

    it('returns false for loan with no pending amount', () => {
      const loan = createLoan({ pendingAmountStored: 0 })
      expect(isActiveLoan(loan)).toBe(false)
    })

    it('returns false for loan with badDebtDate', () => {
      const loan = createLoan({ badDebtDate: new Date() })
      expect(isActiveLoan(loan)).toBe(false)
    })

    it('returns false for loan excluded by cleanup', () => {
      const loan = createLoan({ excludedByCleanup: 'cleanup-123' })
      expect(isActiveLoan(loan)).toBe(false)
    })

    it('returns false for negative pending amount', () => {
      const loan = createLoan({ pendingAmountStored: -100 })
      expect(isActiveLoan(loan)).toBe(false)
    })
  })

  describe('countPaymentsInWeek', () => {
    const week = getActiveWeekRange(new Date('2024-12-11T12:00:00')) // Dec 9-15, 2024

    it('counts payments within week', () => {
      const payments = [
        createPayment(new Date('2024-12-10T12:00:00')), // Tuesday
        createPayment(new Date('2024-12-12T12:00:00')), // Thursday
      ]
      expect(countPaymentsInWeek(payments, week)).toBe(2)
    })

    it('ignores payments outside week', () => {
      const payments = [
        createPayment(new Date('2024-12-08T12:00:00')), // Before week (Sunday)
        createPayment(new Date('2024-12-10T12:00:00')), // In week (Tuesday)
        createPayment(new Date('2024-12-16T12:00:00')), // After week (Monday next)
      ]
      expect(countPaymentsInWeek(payments, week)).toBe(1)
    })

    it('returns 0 for no payments', () => {
      expect(countPaymentsInWeek([], week)).toBe(0)
    })

    it('includes payment on Monday 00:00', () => {
      const payments = [createPayment(new Date('2024-12-09T00:00:00'))]
      expect(countPaymentsInWeek(payments, week)).toBe(1)
    })

    it('includes payment on Sunday 23:59', () => {
      const payments = [createPayment(new Date('2024-12-15T23:59:59'))]
      expect(countPaymentsInWeek(payments, week)).toBe(1)
    })
  })

  describe('isInCarteraVencida', () => {
    const week = getActiveWeekRange(new Date('2024-12-11')) // Dec 9-15, 2024

    it('returns true when no payments in week', () => {
      const loan = createLoan({ signDate: new Date('2024-11-01') })
      const payments: PaymentForCV[] = []

      expect(isInCarteraVencida(loan, payments, week)).toBe(true)
    })

    it('returns false when has payment in week', () => {
      const loan = createLoan({ signDate: new Date('2024-11-01') })
      const payments = [createPayment(new Date('2024-12-10'))]

      expect(isInCarteraVencida(loan, payments, week)).toBe(false)
    })

    it('returns false for loan signed in current week (grace period)', () => {
      const loan = createLoan({ signDate: new Date('2024-12-10') })
      const payments: PaymentForCV[] = []

      expect(isInCarteraVencida(loan, payments, week)).toBe(false)
    })

    it('returns false for non-active loan', () => {
      const loan = createLoan({ pendingAmountStored: 0 })
      const payments: PaymentForCV[] = []

      expect(isInCarteraVencida(loan, payments, week)).toBe(false)
    })

    it('returns false for bad debt loan', () => {
      const loan = createLoan({ badDebtDate: new Date() })
      const payments: PaymentForCV[] = []

      expect(isInCarteraVencida(loan, payments, week)).toBe(false)
    })
  })

  describe('exitedCarteraVencida', () => {
    const currentWeek = getActiveWeekRange(new Date('2024-12-11'))
    const previousWeek = getPreviousWeek(currentWeek)

    it('returns true when 2+ payments in current week after being in CV', () => {
      const payments = [
        // No payments in previous week (was in CV)
        createPayment(new Date('2024-12-10')), // Current week
        createPayment(new Date('2024-12-11')), // Current week
      ]

      expect(exitedCarteraVencida(payments, previousWeek, currentWeek)).toBe(true)
    })

    it('returns false when only 1 payment in current week', () => {
      const payments = [
        createPayment(new Date('2024-12-10')), // Only 1 payment
      ]

      expect(exitedCarteraVencida(payments, previousWeek, currentWeek)).toBe(false)
    })

    it('returns false when had payment in previous week (was not in CV)', () => {
      const payments = [
        createPayment(new Date('2024-12-04')), // Previous week
        createPayment(new Date('2024-12-10')), // Current week
        createPayment(new Date('2024-12-11')), // Current week
      ]

      expect(exitedCarteraVencida(payments, previousWeek, currentWeek)).toBe(false)
    })
  })

  describe('calculateCVStatus', () => {
    const activeWeek = getActiveWeekRange(new Date('2024-12-11'))
    const previousWeek = getPreviousWeek(activeWeek)

    it('returns EXCLUIDO for bad debt', () => {
      const loan = createLoan({ badDebtDate: new Date() })
      const result = calculateCVStatus(loan, [], activeWeek, previousWeek)

      expect(result.status).toBe('EXCLUIDO')
      expect(result.exclusionReason).toBe('BAD_DEBT')
    })

    it('returns EXCLUIDO for cleanup', () => {
      const loan = createLoan({ excludedByCleanup: 'cleanup-1' })
      const result = calculateCVStatus(loan, [], activeWeek, previousWeek)

      expect(result.status).toBe('EXCLUIDO')
      expect(result.exclusionReason).toBe('CLEANUP')
    })

    it('returns EXCLUIDO for no pending amount', () => {
      const loan = createLoan({ pendingAmountStored: 0 })
      const result = calculateCVStatus(loan, [], activeWeek, previousWeek)

      expect(result.status).toBe('EXCLUIDO')
      expect(result.exclusionReason).toBe('NOT_ACTIVE')
    })

    it('returns EN_CV when no payments', () => {
      const loan = createLoan({ signDate: new Date('2024-11-01') })
      const result = calculateCVStatus(loan, [], activeWeek, previousWeek)

      expect(result.status).toBe('EN_CV')
      expect(result.paymentsInWeek).toBe(0)
    })

    it('returns AL_CORRIENTE when has payment', () => {
      const loan = createLoan({ signDate: new Date('2024-11-01') })
      const payments = [createPayment(new Date('2024-12-10'))]
      const result = calculateCVStatus(loan, payments, activeWeek, previousWeek)

      expect(result.status).toBe('AL_CORRIENTE')
      expect(result.paymentsInWeek).toBe(1)
    })

    it('tracks exitedCVThisWeek correctly', () => {
      const loan = createLoan({ signDate: new Date('2024-11-01') })
      const payments = [
        // No payments in previous week (was in CV)
        createPayment(new Date('2024-12-10')), // Current week
        createPayment(new Date('2024-12-11')), // Current week
      ]
      const result = calculateCVStatus(loan, payments, activeWeek, previousWeek)

      expect(result.status).toBe('AL_CORRIENTE')
      expect(result.exitedCVThisWeek).toBe(true)
    })
  })

  describe('isNewClient', () => {
    it('returns true when no previous loan', () => {
      const loan = createLoan({ previousLoan: null })
      expect(isNewClient(loan)).toBe(true)
    })

    it('returns false when has previous loan', () => {
      const loan = createLoan({ previousLoan: 'loan-prev' })
      expect(isNewClient(loan)).toBe(false)
    })
  })

  describe('isFinishedWithoutRenewal', () => {
    const periodStart = new Date('2024-12-01')
    const periodEnd = new Date('2024-12-31')

    it('returns true when finished in period without renewal', () => {
      const loan = createLoan({
        finishedDate: new Date('2024-12-15'),
        renewedDate: null,
      })
      expect(isFinishedWithoutRenewal(loan, periodStart, periodEnd)).toBe(true)
    })

    it('returns false when finished but renewed', () => {
      const loan = createLoan({
        finishedDate: new Date('2024-12-15'),
        renewedDate: new Date('2024-12-15'),
      })
      expect(isFinishedWithoutRenewal(loan, periodStart, periodEnd)).toBe(false)
    })

    it('returns false when not finished', () => {
      const loan = createLoan({ finishedDate: null })
      expect(isFinishedWithoutRenewal(loan, periodStart, periodEnd)).toBe(false)
    })

    it('returns false when finished outside period', () => {
      const loan = createLoan({
        finishedDate: new Date('2024-11-15'),
        renewedDate: null,
      })
      expect(isFinishedWithoutRenewal(loan, periodStart, periodEnd)).toBe(false)
    })
  })

  describe('isRenewalInPeriod', () => {
    const periodStart = new Date('2024-12-01')
    const periodEnd = new Date('2024-12-31')

    it('returns true when renewed in period', () => {
      const loan = createLoan({ renewedDate: new Date('2024-12-15') })
      expect(isRenewalInPeriod(loan, periodStart, periodEnd)).toBe(true)
    })

    it('returns false when not renewed', () => {
      const loan = createLoan({ renewedDate: null })
      expect(isRenewalInPeriod(loan, periodStart, periodEnd)).toBe(false)
    })

    it('returns false when renewed outside period', () => {
      const loan = createLoan({ renewedDate: new Date('2024-11-15') })
      expect(isRenewalInPeriod(loan, periodStart, periodEnd)).toBe(false)
    })
  })

  describe('isNewClientInPeriod', () => {
    const periodStart = new Date('2024-12-01')
    const periodEnd = new Date('2024-12-31')

    it('returns true for new client signed in period', () => {
      const loan = createLoan({
        previousLoan: null,
        signDate: new Date('2024-12-10'),
      })
      expect(isNewClientInPeriod(loan, periodStart, periodEnd)).toBe(true)
    })

    it('returns false for renewal signed in period', () => {
      const loan = createLoan({
        previousLoan: 'loan-prev',
        signDate: new Date('2024-12-10'),
      })
      expect(isNewClientInPeriod(loan, periodStart, periodEnd)).toBe(false)
    })

    it('returns false for new client signed outside period', () => {
      const loan = createLoan({
        previousLoan: null,
        signDate: new Date('2024-11-10'),
      })
      expect(isNewClientInPeriod(loan, periodStart, periodEnd)).toBe(false)
    })
  })

  describe('calculateTrend', () => {
    it('returns UP when current > previous', () => {
      expect(calculateTrend(10, 5)).toBe('UP')
    })

    it('returns DOWN when current < previous', () => {
      expect(calculateTrend(5, 10)).toBe('DOWN')
    })

    it('returns STABLE when equal', () => {
      expect(calculateTrend(5, 5)).toBe('STABLE')
    })
  })

  describe('calculateClientBalance', () => {
    const periodStart = new Date('2024-12-01')
    const periodEnd = new Date('2024-12-31')

    it('calculates balance correctly', () => {
      const loans = [
        // 3 new clients
        createLoan({ previousLoan: null, signDate: new Date('2024-12-05') }),
        createLoan({ previousLoan: null, signDate: new Date('2024-12-10') }),
        createLoan({ previousLoan: null, signDate: new Date('2024-12-15') }),
        // 1 finished without renewal
        createLoan({
          finishedDate: new Date('2024-12-20'),
          renewedDate: null,
        }),
        // 2 renewals
        createLoan({ renewedDate: new Date('2024-12-12') }),
        createLoan({ renewedDate: new Date('2024-12-18') }),
      ]

      const result = calculateClientBalance(loans, periodStart, periodEnd)

      expect(result.nuevos).toBe(3)
      expect(result.terminadosSinRenovar).toBe(1)
      expect(result.renovados).toBe(2)
      expect(result.balance).toBe(2) // 3 - 1
    })

    it('calculates trend when previous balance provided', () => {
      const loans = [
        createLoan({ previousLoan: null, signDate: new Date('2024-12-05') }),
      ]

      const result = calculateClientBalance(loans, periodStart, periodEnd, -5)
      expect(result.trend).toBe('UP') // 1 is better than -5
    })

    it('returns STABLE trend when no previous balance', () => {
      const loans: LoanForPortfolio[] = []
      const result = calculateClientBalance(loans, periodStart, periodEnd)
      expect(result.trend).toBe('STABLE')
    })
  })

  describe('calculateRenovationKPIs', () => {
    const periodStart = new Date('2024-12-01')
    const periodEnd = new Date('2024-12-31')

    it('calculates renovation rate correctly', () => {
      const loans = [
        // 4 renewals
        createLoan({ renewedDate: new Date('2024-12-10') }),
        createLoan({ renewedDate: new Date('2024-12-12') }),
        createLoan({ renewedDate: new Date('2024-12-15') }),
        createLoan({ renewedDate: new Date('2024-12-18') }),
        // 1 finished without renewal
        createLoan({
          finishedDate: new Date('2024-12-20'),
          renewedDate: null,
        }),
      ]

      const result = calculateRenovationKPIs(loans, periodStart, periodEnd)

      expect(result.totalRenovaciones).toBe(4)
      expect(result.totalCierresSinRenovar).toBe(1)
      expect(result.tasaRenovacion).toBe(0.8) // 4/5
    })

    it('handles zero total gracefully', () => {
      const loans: LoanForPortfolio[] = []
      const result = calculateRenovationKPIs(loans, periodStart, periodEnd)

      expect(result.tasaRenovacion).toBe(0)
    })

    it('calculates trend correctly', () => {
      const loans = [
        createLoan({ renewedDate: new Date('2024-12-10') }),
      ]

      const result = calculateRenovationKPIs(loans, periodStart, periodEnd, 0.5)
      expect(result.tendencia).toBe('UP') // 1.0 > 0.5
    })
  })

  describe('countClientsStatus', () => {
    it('counts active clients and CV correctly', () => {
      const activeWeek = getActiveWeekRange(new Date('2024-12-11'))

      const loans = [
        // Active and Al Corriente
        createLoan({ id: 'loan-1', signDate: new Date('2024-11-01') }),
        // Active but in CV (no payment)
        createLoan({ id: 'loan-2', signDate: new Date('2024-11-01') }),
        // Not active (paid off)
        createLoan({ id: 'loan-3', pendingAmountStored: 0 }),
        // Not active (bad debt)
        createLoan({ id: 'loan-4', badDebtDate: new Date() }),
      ]

      const paymentsMap = new Map<string, PaymentForCV[]>([
        ['loan-1', [createPayment(new Date('2024-12-10'))]],
        ['loan-2', []], // No payments
        ['loan-3', []],
        ['loan-4', []],
      ])

      const result = countClientsStatus(loans, paymentsMap, activeWeek)

      expect(result.totalActivos).toBe(2) // loan-1 and loan-2
      expect(result.enCV).toBe(1) // loan-2
      expect(result.alCorriente).toBe(1) // loan-1
    })
  })
})
