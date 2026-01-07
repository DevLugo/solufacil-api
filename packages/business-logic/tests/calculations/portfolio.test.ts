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
  isReintegroInPeriod,
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

    // NEW: wasRenewed field takes precedence over renewedDate
    it('uses wasRenewed field when available (from query)', () => {
      // Even with renewedDate null, if wasRenewed is true, it was renewed
      const loan = createLoan({
        finishedDate: new Date('2024-12-15'),
        renewedDate: null, // Old field empty (migrated data)
        wasRenewed: true, // New field from EXISTS query
      })
      expect(isFinishedWithoutRenewal(loan, periodStart, periodEnd)).toBe(false)
    })

    it('returns true when wasRenewed is explicitly false', () => {
      const loan = createLoan({
        finishedDate: new Date('2024-12-15'),
        renewedDate: null,
        wasRenewed: false,
      })
      expect(isFinishedWithoutRenewal(loan, periodStart, periodEnd)).toBe(true)
    })
  })

  describe('isRenewalInPeriod', () => {
    const periodStart = new Date('2024-12-01')
    const periodEnd = new Date('2024-12-31')

    // TRUE renewal: previousLoan exists AND previous loan had pending debt
    // (amountGived < requestedAmount means debt was deducted)
    it('returns true for TRUE renewal (previousLoan + debt deducted)', () => {
      const loan = createLoan({
        previousLoan: 'loan-prev',
        signDate: new Date('2024-12-15'),
        requestedAmount: 3000,
        amountGived: 900, // < requestedAmount → debt was deducted
      })
      expect(isRenewalInPeriod(loan, periodStart, periodEnd)).toBe(true)
    })

    it('returns false when no previousLoan (new client)', () => {
      const loan = createLoan({
        previousLoan: null,
        signDate: new Date('2024-12-15'),
        requestedAmount: 3000,
        amountGived: 3000,
      })
      expect(isRenewalInPeriod(loan, periodStart, periodEnd)).toBe(false)
    })

    it('returns false when signed outside period', () => {
      const loan = createLoan({
        previousLoan: 'loan-prev',
        signDate: new Date('2024-11-15'),
        requestedAmount: 3000,
        amountGived: 900,
      })
      expect(isRenewalInPeriod(loan, periodStart, periodEnd)).toBe(false)
    })

    // NOT a renewal: previous loan was already paid off
    it('returns false when previous loan was paid off (amountGived == requestedAmount)', () => {
      const loan = createLoan({
        previousLoan: 'loan-prev',
        signDate: new Date('2024-12-15'),
        requestedAmount: 3000,
        amountGived: 3000, // == requestedAmount → no debt deducted
      })
      expect(isRenewalInPeriod(loan, periodStart, periodEnd)).toBe(false)
    })

    // Fallback: if amounts not available, just check previousLoan
    it('falls back to previousLoan check if amounts not available', () => {
      const loan = createLoan({
        previousLoan: 'loan-prev',
        signDate: new Date('2024-12-15'),
        // No requestedAmount or amountGived
      })
      expect(isRenewalInPeriod(loan, periodStart, periodEnd)).toBe(true)
    })
  })

  describe('isReintegroInPeriod', () => {
    const periodStart = new Date('2024-12-01')
    const periodEnd = new Date('2024-12-31')

    // Reintegro: client returning after paying off previous loan completely
    // (amountGived === requestedAmount means no debt was deducted)
    it('returns true for reintegro (previousLoan + no debt deducted)', () => {
      const loan = createLoan({
        previousLoan: 'loan-prev',
        signDate: new Date('2024-12-15'),
        requestedAmount: 3000,
        amountGived: 3000, // === requestedAmount → no debt deducted
      })
      expect(isReintegroInPeriod(loan, periodStart, periodEnd)).toBe(true)
    })

    it('returns false when no previousLoan (new client, not reintegro)', () => {
      const loan = createLoan({
        previousLoan: null,
        signDate: new Date('2024-12-15'),
        requestedAmount: 3000,
        amountGived: 3000,
      })
      expect(isReintegroInPeriod(loan, periodStart, periodEnd)).toBe(false)
    })

    it('returns false when signed outside period', () => {
      const loan = createLoan({
        previousLoan: 'loan-prev',
        signDate: new Date('2024-11-15'),
        requestedAmount: 3000,
        amountGived: 3000,
      })
      expect(isReintegroInPeriod(loan, periodStart, periodEnd)).toBe(false)
    })

    // NOT a reintegro: debt was carried over (it's a renewal)
    it('returns false when debt was deducted (amountGived < requestedAmount)', () => {
      const loan = createLoan({
        previousLoan: 'loan-prev',
        signDate: new Date('2024-12-15'),
        requestedAmount: 3000,
        amountGived: 900, // < requestedAmount → debt was deducted, it's a renewal
      })
      expect(isReintegroInPeriod(loan, periodStart, periodEnd)).toBe(false)
    })

    // If amounts not available, default to false (safer to undercount)
    it('returns false if amounts not available', () => {
      const loan = createLoan({
        previousLoan: 'loan-prev',
        signDate: new Date('2024-12-15'),
        // No requestedAmount or amountGived
      })
      expect(isReintegroInPeriod(loan, periodStart, periodEnd)).toBe(false)
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

    it('calculates balance correctly with nuevos, renovados, reintegros and terminados', () => {
      const loans = [
        // 3 new clients (previousLoan = null)
        createLoan({ previousLoan: null, signDate: new Date('2024-12-05') }),
        createLoan({ previousLoan: null, signDate: new Date('2024-12-10') }),
        createLoan({ previousLoan: null, signDate: new Date('2024-12-15') }),
        // 1 finished without renewal
        createLoan({
          finishedDate: new Date('2024-12-20'),
          renewedDate: null,
          wasRenewed: false,
        }),
        // 2 TRUE renewals (previousLoan + signDate in period + amountGived < requestedAmount)
        createLoan({
          previousLoan: 'prev-1',
          signDate: new Date('2024-12-12'),
          requestedAmount: 3000,
          amountGived: 2100, // Less than requested = debt was carried over
        }),
        createLoan({
          previousLoan: 'prev-2',
          signDate: new Date('2024-12-18'),
          requestedAmount: 4000,
          amountGived: 3500,
        }),
        // 2 reintegros (previousLoan + signDate in period + amountGived === requestedAmount)
        createLoan({
          previousLoan: 'prev-3',
          signDate: new Date('2024-12-08'),
          requestedAmount: 3000,
          amountGived: 3000, // Equal = no debt carried, client paid off previous loan
        }),
        createLoan({
          previousLoan: 'prev-4',
          signDate: new Date('2024-12-22'),
          requestedAmount: 5000,
          amountGived: 5000,
        }),
      ]

      const result = calculateClientBalance(loans, periodStart, periodEnd)

      expect(result.nuevos).toBe(3)
      expect(result.terminadosSinRenovar).toBe(1)
      expect(result.renovados).toBe(2)
      expect(result.reintegros).toBe(2)
      // Balance = nuevos + reintegros - terminadosSinRenovar = 3 + 2 - 1 = 4
      expect(result.balance).toBe(4)
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
        // 4 TRUE renewals (previousLoan + signDate in period + amountGived < requestedAmount)
        createLoan({
          previousLoan: 'prev-1',
          signDate: new Date('2024-12-10'),
          requestedAmount: 3000,
          amountGived: 2100,
        }),
        createLoan({
          previousLoan: 'prev-2',
          signDate: new Date('2024-12-12'),
          requestedAmount: 3000,
          amountGived: 2500,
        }),
        createLoan({
          previousLoan: 'prev-3',
          signDate: new Date('2024-12-15'),
          requestedAmount: 3000,
          amountGived: 1800,
        }),
        createLoan({
          previousLoan: 'prev-4',
          signDate: new Date('2024-12-18'),
          requestedAmount: 3000,
          amountGived: 2900,
        }),
        // 1 finished without renewal
        createLoan({
          finishedDate: new Date('2024-12-20'),
          renewedDate: null,
          wasRenewed: false,
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
        // TRUE renewal
        createLoan({
          previousLoan: 'prev-1',
          signDate: new Date('2024-12-10'),
          requestedAmount: 3000,
          amountGived: 2100,
        }),
      ]

      const result = calculateRenovationKPIs(loans, periodStart, periodEnd, 0.5)
      expect(result.tendencia).toBe('UP') // 1.0 > 0.5
    })
  })

  describe('countClientsStatus', () => {
    it('counts active clients and CV correctly', () => {
      const activeWeek = getActiveWeekRange(new Date('2024-12-11'))

      const loans = [
        // Active and Al Corriente (has pending debt)
        createLoan({
          id: 'loan-1',
          signDate: new Date('2024-11-01'),
          requestedAmount: 3000,
          rate: 0.4,
          totalPaid: 1000, // Still has pending debt
        }),
        // Active but in CV (no payment, has pending debt)
        createLoan({
          id: 'loan-2',
          signDate: new Date('2024-11-01'),
          requestedAmount: 3000,
          rate: 0.4,
          totalPaid: 500, // Still has pending debt
        }),
        // Not active (paid off completely - has finishedDate)
        createLoan({
          id: 'loan-3',
          pendingAmountStored: 0,
          finishedDate: new Date('2024-12-01'), // Marked as finished
          requestedAmount: 3000,
          rate: 0.4,
          totalPaid: 4200, // Fully paid
        }),
        // Not active (excluded by cleanup)
        createLoan({
          id: 'loan-4',
          excludedByCleanup: 'cleanup-1',
          requestedAmount: 3000,
          rate: 0.4,
          totalPaid: 0,
        }),
      ]

      const paymentsMap = new Map<string, PaymentForCV[]>([
        ['loan-1', [createPayment(new Date('2024-12-10'))]],
        ['loan-2', []], // No payments
        ['loan-3', []],
        ['loan-4', []],
      ])

      // Use isHistorical=true to use the activeWeek.end as reference date
      const result = countClientsStatus(loans, paymentsMap, activeWeek, true)

      expect(result.totalActivos).toBe(2) // loan-1 and loan-2
      expect(result.enCV).toBe(1) // loan-2
      expect(result.alCorriente).toBe(1) // loan-1
    })
  })
})
