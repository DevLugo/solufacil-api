import { describe, it, expect } from 'vitest'
import {
  calculateProfitHeredado,
  calculateRenewalMetrics,
  calculateAmountToGive,
} from '../../src/calculations/profit'
import { Decimal } from 'decimal.js'

/**
 * Test Suite para Lógica de Renovación de Créditos
 *
 * Escenario Base: Crédito a 14 semanas
 * - requestedAmount: $3,000
 * - rate: 40% (0.40)
 * - profitAmount: $1,200 (3000 × 0.40)
 * - totalDebtAcquired: $4,200 (3000 + 1200)
 * - expectedWeeklyPayment: $300 (4200 / 14)
 *
 * Distribución por pago de $300:
 * - Profit por pago: $300 × (1200/4200) = $85.71
 * - ReturnToCapital por pago: $300 - $85.71 = $214.29
 *
 * Profit ratio: 1200/4200 = 0.2857 (28.57%)
 */
describe('Renewal Calculations', () => {
  // Constantes del préstamo base para los tests
  const ORIGINAL_LOAN = {
    requestedAmount: new Decimal(3000),
    rate: new Decimal(0.40),
    weekDuration: 14,
    profitAmount: new Decimal(1200),
    totalDebtAcquired: new Decimal(4200),
    weeklyPayment: new Decimal(300),
    profitPerPayment: new Decimal('85.71'),
    returnPerPayment: new Decimal('214.29'),
    profitRatio: new Decimal('0.2857'),
  }

  describe('calculateProfitHeredado', () => {
    it('calculates profit heredado correctly when 0 payments made (full debt pending)', () => {
      // Escenario A: Sin pagos - deuda pendiente = deuda total
      const result = calculateProfitHeredado(
        new Decimal(4200), // pendingAmountStored = total debt
        ORIGINAL_LOAN.profitAmount,
        ORIGINAL_LOAN.totalDebtAcquired
      )

      // profitHeredado = 4200 × (1200/4200) = 1200
      expect(result.profitHeredado.toNumber()).toBe(1200)
      expect(result.profitRatio.toNumber()).toBeCloseTo(0.2857, 4)
    })

    it('calculates profit heredado correctly when 5 payments made (5 of 14)', () => {
      // Escenario B: 5 pagos realizados
      // Deuda pendiente = 4200 - (5 × 300) = 4200 - 1500 = 2700
      const pendingDebt = new Decimal(2700)

      const result = calculateProfitHeredado(
        pendingDebt,
        ORIGINAL_LOAN.profitAmount,
        ORIGINAL_LOAN.totalDebtAcquired
      )

      // profitHeredado = 2700 × (1200/4200) = 2700 × 0.2857 = 771.43
      expect(result.profitHeredado.toNumber()).toBeCloseTo(771.43, 2)
    })

    it('calculates profit heredado correctly when 8 payments made (8 of 14)', () => {
      // Escenario C: 8 pagos realizados
      // Deuda pendiente = 4200 - (8 × 300) = 4200 - 2400 = 1800
      const pendingDebt = new Decimal(1800)

      const result = calculateProfitHeredado(
        pendingDebt,
        ORIGINAL_LOAN.profitAmount,
        ORIGINAL_LOAN.totalDebtAcquired
      )

      // profitHeredado = 1800 × (1200/4200) = 1800 × 0.2857 = 514.29
      expect(result.profitHeredado.toNumber()).toBeCloseTo(514.29, 2)
    })

    it('calculates profit heredado correctly when 10 payments made (10 of 14)', () => {
      // Escenario D: 10 pagos realizados (caso típico de renovación)
      // Deuda pendiente = 4200 - (10 × 300) = 4200 - 3000 = 1200
      const pendingDebt = new Decimal(1200)

      const result = calculateProfitHeredado(
        pendingDebt,
        ORIGINAL_LOAN.profitAmount,
        ORIGINAL_LOAN.totalDebtAcquired
      )

      // profitHeredado = 1200 × (1200/4200) = 1200 × 0.2857 = 342.86
      expect(result.profitHeredado.toNumber()).toBeCloseTo(342.86, 2)
    })

    it('returns zero when previous total debt is zero', () => {
      const result = calculateProfitHeredado(
        new Decimal(1000),
        new Decimal(0),
        new Decimal(0) // Division by zero case
      )

      expect(result.profitHeredado.toNumber()).toBe(0)
      expect(result.profitRatio.toNumber()).toBe(0)
    })

    it('handles different profit ratios (30% rate loan)', () => {
      // Préstamo con rate 30%: $3000 × 0.30 = $900 profit
      // totalDebt = 3000 + 900 = 3900
      // profitRatio = 900/3900 = 0.2308 (23.08%)
      const result = calculateProfitHeredado(
        new Decimal(1950), // 50% pending
        new Decimal(900),
        new Decimal(3900)
      )

      // profitHeredado = 1950 × 0.2308 = 450
      expect(result.profitHeredado.toNumber()).toBeCloseTo(450, 2)
    })

    it('handles higher rate loans (50% rate)', () => {
      // Préstamo con rate 50%: $3000 × 0.50 = $1500 profit
      // totalDebt = 3000 + 1500 = 4500
      // profitRatio = 1500/4500 = 0.3333 (33.33%)
      const result = calculateProfitHeredado(
        new Decimal(2250), // 50% pending
        new Decimal(1500),
        new Decimal(4500)
      )

      // profitHeredado = 2250 × 0.3333 = 750
      expect(result.profitHeredado.toNumber()).toBeCloseTo(750, 2)
    })
  })

  describe('calculateAmountToGive', () => {
    it('calculates amount to give when pending debt is less than requested', () => {
      // Cliente solicita $3000, tiene $1200 de deuda pendiente
      const result = calculateAmountToGive(new Decimal(3000), new Decimal(1200))
      expect(result.toNumber()).toBe(1800)
    })

    it('returns zero when pending debt equals requested amount', () => {
      const result = calculateAmountToGive(new Decimal(3000), new Decimal(3000))
      expect(result.toNumber()).toBe(0)
    })

    it('returns zero when pending debt exceeds requested amount', () => {
      // Cliente solicita $3000 pero tiene $4200 de deuda pendiente
      const result = calculateAmountToGive(new Decimal(3000), new Decimal(4200))
      expect(result.toNumber()).toBe(0)
    })

    it('handles zero pending debt (new loan scenario)', () => {
      const result = calculateAmountToGive(new Decimal(3000), new Decimal(0))
      expect(result.toNumber()).toBe(3000)
    })
  })

  describe('calculateRenewalMetrics', () => {
    describe('Escenario D: 10 pagos de 14 realizados', () => {
      // Escenario más común: renovación con 4 pagos pendientes
      // Deuda pendiente: 4 × $300 = $1,200
      const previousLoan = {
        pendingAmountStored: new Decimal(1200),
        profitAmount: new Decimal(1200),
        totalDebtAcquired: new Decimal(4200),
      }

      it('calculates all metrics correctly', () => {
        const result = calculateRenewalMetrics(
          new Decimal(3000), // requestedAmount
          new Decimal(0.40), // rate
          14, // weekDuration
          previousLoan
        )

        // Verificar profit base
        expect(result.profitBase.toNumber()).toBe(1200)

        // Verificar profit heredado: 1200 × 0.2857 = 342.86
        expect(result.profitHeredado.toNumber()).toBeCloseTo(342.86, 2)

        // Verificar profit total: 1200 + 342.86 = 1542.86
        expect(result.profitTotal.toNumber()).toBeCloseTo(1542.86, 2)

        // Verificar returnToCapital
        expect(result.returnToCapital.toNumber()).toBe(3000)

        // Verificar deuda total: 3000 + 1542.86 = 4542.86
        expect(result.totalDebtAcquired.toNumber()).toBeCloseTo(4542.86, 2)

        // Verificar monto a entregar: 3000 - 1200 = 1800
        expect(result.amountGived.toNumber()).toBe(1800)

        // Verificar pago semanal: 4542.86 / 14 = 324.49
        expect(result.expectedWeeklyPayment.toNumber()).toBeCloseTo(324.49, 2)
      })
    })

    describe('Escenario A: Sin pagos realizados (renovación inmediata)', () => {
      const previousLoan = {
        pendingAmountStored: new Decimal(4200), // Full debt pending
        profitAmount: new Decimal(1200),
        totalDebtAcquired: new Decimal(4200),
      }

      it('calculates metrics with full profit heredado', () => {
        const result = calculateRenewalMetrics(
          new Decimal(3000),
          new Decimal(0.40),
          14,
          previousLoan
        )

        // Profit heredado = todo el profit original: 4200 × 0.2857 = 1200
        expect(result.profitHeredado.toNumber()).toBe(1200)

        // Profit total: 1200 + 1200 = 2400
        expect(result.profitTotal.toNumber()).toBe(2400)

        // Deuda total: 3000 + 2400 = 5400
        expect(result.totalDebtAcquired.toNumber()).toBe(5400)

        // Monto a entregar: 3000 - 4200 = -1200 → 0 (no puede ser negativo)
        expect(result.amountGived.toNumber()).toBe(0)
      })
    })

    describe('Escenario B: 5 pagos de 14 realizados', () => {
      // Deuda pendiente: 9 × $300 = $2,700
      const previousLoan = {
        pendingAmountStored: new Decimal(2700),
        profitAmount: new Decimal(1200),
        totalDebtAcquired: new Decimal(4200),
      }

      it('calculates metrics correctly', () => {
        const result = calculateRenewalMetrics(
          new Decimal(3000),
          new Decimal(0.40),
          14,
          previousLoan
        )

        // Profit heredado: 2700 × 0.2857 = 771.43
        expect(result.profitHeredado.toNumber()).toBeCloseTo(771.43, 2)

        // Profit total: 1200 + 771.43 = 1971.43
        expect(result.profitTotal.toNumber()).toBeCloseTo(1971.43, 2)

        // Deuda total: 3000 + 1971.43 = 4971.43
        expect(result.totalDebtAcquired.toNumber()).toBeCloseTo(4971.43, 2)

        // Monto a entregar: 3000 - 2700 = 300
        expect(result.amountGived.toNumber()).toBe(300)
      })
    })

    describe('Escenario C: 8 pagos de 14 realizados', () => {
      // Deuda pendiente: 6 × $300 = $1,800
      const previousLoan = {
        pendingAmountStored: new Decimal(1800),
        profitAmount: new Decimal(1200),
        totalDebtAcquired: new Decimal(4200),
      }

      it('calculates metrics correctly', () => {
        const result = calculateRenewalMetrics(
          new Decimal(3000),
          new Decimal(0.40),
          14,
          previousLoan
        )

        // Profit heredado: 1800 × 0.2857 = 514.29
        expect(result.profitHeredado.toNumber()).toBeCloseTo(514.29, 2)

        // Profit total: 1200 + 514.29 = 1714.29
        expect(result.profitTotal.toNumber()).toBeCloseTo(1714.29, 2)

        // Deuda total: 3000 + 1714.29 = 4714.29
        expect(result.totalDebtAcquired.toNumber()).toBeCloseTo(4714.29, 2)

        // Monto a entregar: 3000 - 1800 = 1200
        expect(result.amountGived.toNumber()).toBe(1200)
      })
    })

    describe('Edge Cases', () => {
      it('handles renewal with different requested amount', () => {
        const previousLoan = {
          pendingAmountStored: new Decimal(1200),
          profitAmount: new Decimal(1200),
          totalDebtAcquired: new Decimal(4200),
        }

        // Cliente solicita $5000 en lugar de $3000
        const result = calculateRenewalMetrics(
          new Decimal(5000), // Different amount
          new Decimal(0.40),
          14,
          previousLoan
        )

        // Profit base: 5000 × 0.40 = 2000
        expect(result.profitBase.toNumber()).toBe(2000)

        // Profit heredado sigue siendo el mismo: 1200 × 0.2857 = 342.86
        expect(result.profitHeredado.toNumber()).toBeCloseTo(342.86, 2)

        // Profit total: 2000 + 342.86 = 2342.86
        expect(result.profitTotal.toNumber()).toBeCloseTo(2342.86, 2)

        // Monto a entregar: 5000 - 1200 = 3800
        expect(result.amountGived.toNumber()).toBe(3800)
      })

      it('handles renewal with different rate', () => {
        const previousLoan = {
          pendingAmountStored: new Decimal(1200),
          profitAmount: new Decimal(1200),
          totalDebtAcquired: new Decimal(4200),
        }

        // Nueva tasa del 30%
        const result = calculateRenewalMetrics(
          new Decimal(3000),
          new Decimal(0.30), // Different rate
          14,
          previousLoan
        )

        // Profit base: 3000 × 0.30 = 900
        expect(result.profitBase.toNumber()).toBe(900)

        // Profit heredado: 1200 × 0.2857 = 342.86
        expect(result.profitHeredado.toNumber()).toBeCloseTo(342.86, 2)

        // Profit total: 900 + 342.86 = 1242.86
        expect(result.profitTotal.toNumber()).toBeCloseTo(1242.86, 2)
      })

      it('handles renewal with different week duration', () => {
        const previousLoan = {
          pendingAmountStored: new Decimal(1200),
          profitAmount: new Decimal(1200),
          totalDebtAcquired: new Decimal(4200),
        }

        // Nueva duración de 10 semanas
        const result = calculateRenewalMetrics(
          new Decimal(3000),
          new Decimal(0.40),
          10, // Different duration
          previousLoan
        )

        // Profit total: 1200 + 342.86 = 1542.86
        expect(result.profitTotal.toNumber()).toBeCloseTo(1542.86, 2)

        // Deuda total: 3000 + 1542.86 = 4542.86
        expect(result.totalDebtAcquired.toNumber()).toBeCloseTo(4542.86, 2)

        // Pago semanal: 4542.86 / 10 = 454.29
        expect(result.expectedWeeklyPayment.toNumber()).toBeCloseTo(454.29, 2)
      })
    })
  })

  describe('Verifying BUG FIX: profitHeredado vs pendingAmountStored', () => {
    /**
     * Este test verifica que NO se use pendingAmountStored directamente como profit heredado.
     * El BUG original era: pendingProfit = pendingAmountStored (INCORRECTO)
     * La corrección es: pendingProfit = pendingAmountStored × (profitAmount / totalDebtAcquired)
     */
    it('profitHeredado should NOT equal pendingAmountStored (regression test)', () => {
      const pendingAmountStored = new Decimal(1200)
      const profitAmount = new Decimal(1200)
      const totalDebtAcquired = new Decimal(4200)

      const result = calculateProfitHeredado(
        pendingAmountStored,
        profitAmount,
        totalDebtAcquired
      )

      // El bug haría que profitHeredado = 1200 (pendingAmountStored directo)
      // El cálculo correcto es: 1200 × (1200/4200) = 342.86
      expect(result.profitHeredado.toNumber()).not.toBe(pendingAmountStored.toNumber())
      expect(result.profitHeredado.toNumber()).toBeCloseTo(342.86, 2)
    })

    it('documents the difference between buggy and correct calculation', () => {
      // Escenario: Préstamo con 50% de deuda pendiente
      // pendingAmountStored: $2,100
      // profitAmount: $1,200
      // totalDebtAcquired: $4,200

      const pendingAmountStored = new Decimal(2100)
      const profitAmount = new Decimal(1200)
      const totalDebtAcquired = new Decimal(4200)

      const result = calculateProfitHeredado(
        pendingAmountStored,
        profitAmount,
        totalDebtAcquired
      )

      // BUG (incorrecto): profitHeredado = $2,100 (usa deuda total pendiente)
      // CORRECTO: profitHeredado = $2,100 × (1200/4200) = $600

      const buggyCalculation = pendingAmountStored.toNumber() // $2,100
      const correctCalculation = result.profitHeredado.toNumber() // $600

      expect(correctCalculation).toBe(600)
      expect(correctCalculation).not.toBe(buggyCalculation)
      expect(buggyCalculation - correctCalculation).toBe(1500) // Diferencia de $1,500!
    })
  })
})
