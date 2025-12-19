import { describe, it, expect } from 'vitest'
import { LoanEngine } from '../../src/loan-engine'

describe('LoanEngine', () => {
  // ==========================================================================
  // NEW LOAN CREATION
  // ==========================================================================

  describe('createLoan - New Loan', () => {
    it('creates a basic new loan correctly', () => {
      const result = LoanEngine.createLoan({
        requestedAmount: 3000,
        rate: 0.40,
        weekDuration: 14,
      })

      expect(result.requestedAmount).toBe(3000)
      expect(result.amountGived).toBe(3000) // Full amount for new loan
      expect(result.profitBase).toBe(1200) // 3000 × 0.40
      expect(result.profitHeredado).toBe(0) // No previous loan
      expect(result.profitAmount).toBe(1200)
      expect(result.returnToCapital).toBe(3000)
      expect(result.totalDebtAcquired).toBe(4200) // 3000 + 1200
      expect(result.pendingAmountStored).toBe(4200)
      expect(result.expectedWeeklyPayment).toBe(300) // 4200 / 14
      expect(result.profitRatio).toBeCloseTo(0.2857, 4)
    })

    it('handles different rates correctly', () => {
      const result = LoanEngine.createLoan({
        requestedAmount: 5000,
        rate: 0.30,
        weekDuration: 10,
      })

      expect(result.profitBase).toBe(1500) // 5000 × 0.30
      expect(result.profitAmount).toBe(1500)
      expect(result.totalDebtAcquired).toBe(6500) // 5000 + 1500
      expect(result.expectedWeeklyPayment).toBe(650) // 6500 / 10
    })

    it('handles small amounts correctly', () => {
      const result = LoanEngine.createLoan({
        requestedAmount: 1000,
        rate: 0.25,
        weekDuration: 8,
      })

      expect(result.profitBase).toBe(250)
      expect(result.totalDebtAcquired).toBe(1250)
      expect(result.expectedWeeklyPayment).toBe(156.25) // 1250 / 8
    })
  })

  // ==========================================================================
  // RENEWAL CREATION
  // ==========================================================================

  describe('createLoan - Renewal', () => {
    // Base loan: $3,000 at 40%, 14 weeks
    // profitAmount: $1,200, totalDebtAcquired: $4,200
    // Weekly payment: $300, profit per payment: $85.71

    it('calculates renewal with 10 payments made (Scenario D)', () => {
      // 10 payments of $300 = $3,000 paid
      // Pending: 4 × $300 = $1,200
      const result = LoanEngine.createLoan(
        { requestedAmount: 3000, rate: 0.40, weekDuration: 14 },
        { pendingAmountStored: 1200, profitAmount: 1200, totalDebtAcquired: 4200 }
      )

      expect(result.profitBase).toBe(1200)
      expect(result.profitHeredado).toBeCloseTo(342.86, 2) // 1200 × 0.2857
      expect(result.profitAmount).toBeCloseTo(1542.86, 2)
      expect(result.amountGived).toBe(1800) // 3000 - 1200
      expect(result.totalDebtAcquired).toBeCloseTo(4542.86, 2)
    })

    it('calculates renewal with 0 payments made (Scenario A)', () => {
      // No payments, full debt pending
      const result = LoanEngine.createLoan(
        { requestedAmount: 3000, rate: 0.40, weekDuration: 14 },
        { pendingAmountStored: 4200, profitAmount: 1200, totalDebtAcquired: 4200 }
      )

      expect(result.profitHeredado).toBe(1200) // Full profit inherited
      expect(result.profitAmount).toBe(2400) // 1200 + 1200
      expect(result.amountGived).toBe(0) // 3000 - 4200 = negative, capped at 0
      expect(result.totalDebtAcquired).toBe(5400)
    })

    it('calculates renewal with 5 payments made (Scenario B)', () => {
      // 5 payments of $300 = $1,500 paid
      // Pending: 9 × $300 = $2,700
      const result = LoanEngine.createLoan(
        { requestedAmount: 3000, rate: 0.40, weekDuration: 14 },
        { pendingAmountStored: 2700, profitAmount: 1200, totalDebtAcquired: 4200 }
      )

      expect(result.profitHeredado).toBeCloseTo(771.43, 2) // 2700 × 0.2857
      expect(result.profitAmount).toBeCloseTo(1971.43, 2)
      expect(result.amountGived).toBe(300) // 3000 - 2700
    })

    it('calculates renewal with 8 payments made (Scenario C)', () => {
      // 8 payments of $300 = $2,400 paid
      // Pending: 6 × $300 = $1,800
      const result = LoanEngine.createLoan(
        { requestedAmount: 3000, rate: 0.40, weekDuration: 14 },
        { pendingAmountStored: 1800, profitAmount: 1200, totalDebtAcquired: 4200 }
      )

      expect(result.profitHeredado).toBeCloseTo(514.29, 2) // 1800 × 0.2857
      expect(result.profitAmount).toBeCloseTo(1714.29, 2)
      expect(result.amountGived).toBe(1200) // 3000 - 1800
    })

    it('does NOT use pendingAmountStored directly as profitHeredado (regression test)', () => {
      const result = LoanEngine.createLoan(
        { requestedAmount: 3000, rate: 0.40, weekDuration: 14 },
        { pendingAmountStored: 1200, profitAmount: 1200, totalDebtAcquired: 4200 }
      )

      // BUG would be: profitHeredado = 1200 (using pendingAmountStored directly)
      // CORRECT: profitHeredado = 1200 × (1200/4200) = 342.86
      expect(result.profitHeredado).not.toBe(1200)
      expect(result.profitHeredado).toBeCloseTo(342.86, 2)
    })
  })

  // ==========================================================================
  // PAYMENT PROCESSING
  // ==========================================================================

  describe('processPayment', () => {
    it('distributes payment proportionally', () => {
      const result = LoanEngine.processPayment({
        amount: 300,
        loanProfitAmount: 1200,
        loanTotalDebt: 4200,
        loanPendingAmount: 4200,
      })

      expect(result.amount).toBe(300)
      expect(result.profitAmount).toBeCloseTo(85.71, 2) // 300 × 0.2857
      expect(result.returnToCapital).toBeCloseTo(214.29, 2) // 300 - 85.71
      expect(result.newPendingAmount).toBe(3900) // 4200 - 300
      expect(result.isFullyPaid).toBe(false)
    })

    it('marks loan as fully paid when pending reaches zero', () => {
      const result = LoanEngine.processPayment({
        amount: 300,
        loanProfitAmount: 1200,
        loanTotalDebt: 4200,
        loanPendingAmount: 300, // Last payment
      })

      expect(result.newPendingAmount).toBe(0)
      expect(result.isFullyPaid).toBe(true)
    })

    it('handles overpayment gracefully', () => {
      const result = LoanEngine.processPayment({
        amount: 500,
        loanProfitAmount: 1200,
        loanTotalDebt: 4200,
        loanPendingAmount: 300,
      })

      expect(result.newPendingAmount).toBe(0) // Capped at 0, not negative
      expect(result.isFullyPaid).toBe(true)
    })

    it('sends 100% to profit when bad debt', () => {
      const result = LoanEngine.processPayment({
        amount: 300,
        loanProfitAmount: 1200,
        loanTotalDebt: 4200,
        loanPendingAmount: 1000,
        isBadDebt: true,
      })

      expect(result.profitAmount).toBe(300) // 100% to profit
      expect(result.returnToCapital).toBe(0) // Nothing to capital
    })

    it('handles full loan payment correctly', () => {
      // Full payment of entire debt
      const result = LoanEngine.processPayment({
        amount: 4200,
        loanProfitAmount: 1200,
        loanTotalDebt: 4200,
        loanPendingAmount: 4200,
      })

      expect(result.profitAmount).toBe(1200) // Full profit
      expect(result.returnToCapital).toBe(3000) // Full capital
      expect(result.newPendingAmount).toBe(0)
      expect(result.isFullyPaid).toBe(true)
    })

    it('caps profit at payment amount when corrupt data (profit > totalDebt)', () => {
      // Edge case: corrupt data where loanProfitAmount > loanTotalDebt
      // This should never happen, but we protect against it
      const result = LoanEngine.processPayment({
        amount: 100,
        loanProfitAmount: 5000, // Corrupt: more than total debt
        loanTotalDebt: 4000,
        loanPendingAmount: 1000,
      })

      // Profit should be capped at payment amount (100), not calculated (125)
      expect(result.profitAmount).toBe(100)
      expect(result.returnToCapital).toBe(0)
    })

    it('never returns profit greater than payment (regression test)', () => {
      // Normal case - profit should always be <= payment
      const testCases = [
        { amount: 100, loanProfitAmount: 1200, loanTotalDebt: 4200 },
        { amount: 50, loanProfitAmount: 1500, loanTotalDebt: 3000 },
        { amount: 300, loanProfitAmount: 2000, loanTotalDebt: 5000 },
      ]

      testCases.forEach((testCase) => {
        const result = LoanEngine.processPayment({
          ...testCase,
          loanPendingAmount: 1000,
        })

        expect(result.profitAmount).toBeLessThanOrEqual(testCase.amount)
        expect(result.profitAmount + result.returnToCapital).toBe(testCase.amount)
      })
    })
  })

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  describe('calculateProfitRatio', () => {
    it('calculates ratio correctly', () => {
      expect(LoanEngine.calculateProfitRatio(1200, 4200)).toBeCloseTo(0.2857, 4)
      expect(LoanEngine.calculateProfitRatio(1500, 4500)).toBeCloseTo(0.3333, 4)
      expect(LoanEngine.calculateProfitRatio(900, 3900)).toBeCloseTo(0.2308, 4)
    })

    it('returns 0 when total debt is 0', () => {
      expect(LoanEngine.calculateProfitRatio(1200, 0)).toBe(0)
    })
  })

  describe('calculatePaymentDistribution', () => {
    it('calculates distribution correctly', () => {
      const result = LoanEngine.calculatePaymentDistribution(300, 0.2857)

      expect(result.profit).toBeCloseTo(85.71, 2)
      expect(result.returnToCapital).toBeCloseTo(214.29, 2)
    })

    it('handles 0 ratio', () => {
      const result = LoanEngine.calculatePaymentDistribution(300, 0)

      expect(result.profit).toBe(0)
      expect(result.returnToCapital).toBe(300)
    })
  })

  describe('calculateProfitHeredado', () => {
    it('calculates inherited profit correctly', () => {
      const result = LoanEngine.calculateProfitHeredado(1200, 1200, 4200)
      expect(result).toBeCloseTo(342.86, 2)
    })

    it('returns full profit when no payments made', () => {
      const result = LoanEngine.calculateProfitHeredado(4200, 1200, 4200)
      expect(result).toBe(1200)
    })

    it('returns 0 when total debt is 0', () => {
      const result = LoanEngine.calculateProfitHeredado(1000, 0, 0)
      expect(result).toBe(0)
    })
  })

  describe('getLoanStatus', () => {
    it('returns FINISHED when pending is 0', () => {
      expect(LoanEngine.getLoanStatus(0)).toBe('FINISHED')
      expect(LoanEngine.getLoanStatus(0.005)).toBe('FINISHED') // Within threshold
    })

    it('returns BAD_DEBT when badDebtDate is set', () => {
      expect(LoanEngine.getLoanStatus(1000, new Date())).toBe('BAD_DEBT')
    })

    it('returns ACTIVE for normal loans', () => {
      expect(LoanEngine.getLoanStatus(1000)).toBe('ACTIVE')
      expect(LoanEngine.getLoanStatus(1000, null)).toBe('ACTIVE')
    })
  })

  // ==========================================================================
  // COMPLETE FLOW TESTS
  // ==========================================================================

  describe('Complete Flow: New Loan + Payments + Renewal', () => {
    it('simulates full lifecycle', () => {
      // Step 1: Create new loan
      const newLoan = LoanEngine.createLoan({
        requestedAmount: 3000,
        rate: 0.40,
        weekDuration: 14,
      })

      expect(newLoan.totalDebtAcquired).toBe(4200)
      expect(newLoan.expectedWeeklyPayment).toBe(300)

      // Step 2: Make 10 payments
      let pendingAmount = newLoan.pendingAmountStored
      let totalProfitCollected = 0
      let totalCapitalCollected = 0

      for (let i = 0; i < 10; i++) {
        const payment = LoanEngine.processPayment({
          amount: 300,
          loanProfitAmount: newLoan.profitAmount,
          loanTotalDebt: newLoan.totalDebtAcquired,
          loanPendingAmount: pendingAmount,
        })

        pendingAmount = payment.newPendingAmount
        totalProfitCollected += payment.profitAmount
        totalCapitalCollected += payment.returnToCapital
      }

      // After 10 payments: $3,000 paid, $1,200 pending
      expect(pendingAmount).toBeCloseTo(1200, 2)
      expect(totalProfitCollected).toBeCloseTo(857.1, 1) // 10 × 85.71
      expect(totalCapitalCollected).toBeCloseTo(2142.9, 1) // 10 × 214.29

      // Step 3: Renew the loan
      const renewal = LoanEngine.createLoan(
        { requestedAmount: 3000, rate: 0.40, weekDuration: 14 },
        {
          pendingAmountStored: pendingAmount,
          profitAmount: newLoan.profitAmount,
          totalDebtAcquired: newLoan.totalDebtAcquired,
        }
      )

      // Verify renewal calculations
      expect(renewal.profitHeredado).toBeCloseTo(342.86, 2)
      expect(renewal.profitAmount).toBeCloseTo(1542.86, 2)
      expect(renewal.amountGived).toBe(1800) // 3000 - 1200
      expect(renewal.totalDebtAcquired).toBeCloseTo(4542.86, 2)
    })
  })
})
