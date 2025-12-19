import { describe, it, expect } from 'vitest'
import {
  calculatePendingAmount,
  isLoanFullyPaid,
  calculatePaymentProgress,
} from '../../src/calculations/payment'
import { Decimal } from 'decimal.js'

describe('Payment Calculations', () => {
  describe('calculatePendingAmount', () => {
    it('calculates pending amount correctly', () => {
      const pending = calculatePendingAmount(new Decimal(1200), new Decimal(300))
      expect(pending.toNumber()).toBe(900)
    })

    it('returns 0 when overpaid', () => {
      const pending = calculatePendingAmount(new Decimal(1200), new Decimal(1500))
      expect(pending.toNumber()).toBe(0)
    })

    it('returns 0 when fully paid', () => {
      const pending = calculatePendingAmount(new Decimal(1200), new Decimal(1200))
      expect(pending.toNumber()).toBe(0)
    })
  })

  describe('isLoanFullyPaid', () => {
    it('returns true when fully paid', () => {
      const result = isLoanFullyPaid(new Decimal(1200), new Decimal(1200))
      expect(result).toBe(true)
    })

    it('returns true when overpaid', () => {
      const result = isLoanFullyPaid(new Decimal(1200), new Decimal(1500))
      expect(result).toBe(true)
    })

    it('returns false when partially paid', () => {
      const result = isLoanFullyPaid(new Decimal(1200), new Decimal(800))
      expect(result).toBe(false)
    })
  })

  describe('calculatePaymentProgress', () => {
    it('calculates progress as percentage', () => {
      const progress = calculatePaymentProgress(new Decimal(1200), new Decimal(600))
      expect(progress.toNumber()).toBe(50)
    })

    it('returns 100 when fully paid', () => {
      const progress = calculatePaymentProgress(new Decimal(1200), new Decimal(1200))
      expect(progress.toNumber()).toBe(100)
    })

    it('handles 0 total debt', () => {
      const progress = calculatePaymentProgress(new Decimal(0), new Decimal(0))
      expect(progress.toNumber()).toBe(0)
    })
  })
})
