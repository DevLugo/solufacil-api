import { describe, it, expect } from 'vitest'
import {
  calculateProfit,
  calculatePaymentProfit,
  calculateLoanMetrics,
} from '../../src/calculations/profit'
import { Decimal } from 'decimal.js'

describe('Profit Calculations', () => {
  describe('calculateProfit', () => {
    it('calculates basic profit correctly', () => {
      const result = calculateProfit(new Decimal(1000), new Decimal(0.2))
      expect(result.toNumber()).toBe(200)
    })

    it('calculates profit with 25% rate', () => {
      const result = calculateProfit(new Decimal(5000), new Decimal(0.25))
      expect(result.toNumber()).toBe(1250)
    })

    it('handles zero requested amount', () => {
      const result = calculateProfit(new Decimal(0), new Decimal(0.2))
      expect(result.toNumber()).toBe(0)
    })

    it('rounds to 2 decimal places', () => {
      // 1000 × 0.333 = 333.0 (toDecimalPlaces(2) doesn't add trailing decimals)
      const result = calculateProfit(new Decimal(1000), new Decimal(0.333))
      expect(result.toNumber()).toBe(333)
    })
  })

  describe('calculatePaymentProfit', () => {
    it('calculates proportional payment profit', () => {
      const { profitAmount, returnToCapital } = calculatePaymentProfit(
        new Decimal(100), // payment
        new Decimal(200), // total profit
        new Decimal(1200), // total debt
        false
      )

      expect(profitAmount.toNumber()).toBe(16.67)
      expect(returnToCapital.toNumber()).toBe(83.33)
    })

    it('treats all payment as profit when bad debt', () => {
      const { profitAmount, returnToCapital } = calculatePaymentProfit(
        new Decimal(100),
        new Decimal(200),
        new Decimal(1200),
        true // isBadDebt
      )

      expect(profitAmount.toNumber()).toBe(100)
      expect(returnToCapital.toNumber()).toBe(0)
    })

    it('handles full payment', () => {
      const { profitAmount, returnToCapital } = calculatePaymentProfit(
        new Decimal(1200), // full payment
        new Decimal(200),
        new Decimal(1200),
        false
      )

      expect(profitAmount.toNumber()).toBe(200)
      expect(returnToCapital.toNumber()).toBe(1000)
    })

    it('rounds correctly for small payments', () => {
      const { profitAmount, returnToCapital } = calculatePaymentProfit(
        new Decimal(10),
        new Decimal(200),
        new Decimal(1200),
        false
      )

      expect(profitAmount.toNumber()).toBe(1.67)
      expect(returnToCapital.toNumber()).toBe(8.33)
    })
  })

  describe('calculateLoanMetrics', () => {
    it('calculates all metrics correctly', () => {
      const metrics = calculateLoanMetrics(
        new Decimal(1000), // requested
        new Decimal(0.2), // rate 20%
        10 // weeks
      )

      expect(metrics.profitAmount.toNumber()).toBe(200)
      expect(metrics.totalDebtAcquired.toNumber()).toBe(1200)
      expect(metrics.expectedWeeklyPayment.toNumber()).toBe(120)
    })

    it('calculates metrics for 15 week loan', () => {
      const metrics = calculateLoanMetrics(
        new Decimal(5000),
        new Decimal(0.25), // 25%
        15
      )

      expect(metrics.profitAmount.toNumber()).toBe(1250)
      expect(metrics.totalDebtAcquired.toNumber()).toBe(6250)
      expect(metrics.expectedWeeklyPayment.toNumber()).toBe(416.67)
    })

    it('handles odd weekly payment division', () => {
      const metrics = calculateLoanMetrics(
        new Decimal(1000),
        new Decimal(0.2),
        7 // results in non-round weekly payment
      )

      expect(metrics.expectedWeeklyPayment.toNumber()).toBe(171.43)
    })
  })
})
