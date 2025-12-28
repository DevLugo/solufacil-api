import { describe, it, expect, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'
import { prisma } from './setup'
import {
  setupTestEnvironment,
  assertBalance,
  getBalance,
  trackLeadPaymentReceived,
  createTestLoan,
} from './helpers'
import { PaymentService } from '../PaymentService'

describe('PaymentService Balance Tests', () => {
  let paymentService: PaymentService
  let testEnv: Awaited<ReturnType<typeof setupTestEnvironment>>

  beforeEach(async () => {
    paymentService = new PaymentService(prisma)
    testEnv = await setupTestEnvironment(prisma)
  })

  // ===========================================
  // A. CREAR PAGOS (CreateLeadPaymentReceived)
  // ===========================================

  describe('A. Create Payments', () => {
    it('Scenario 1: 1 CASH payment $100, commission $8 → Cash: +92', async () => {
      const initialBalance = await getBalance(prisma, testEnv.cashAccount.id)

      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 92, // After commission
        bankPaidAmount: 0,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        initialBalance + 92,
        'Cash should increase by 92 (100 payment - 8 commission)'
      )
    })

    it('Scenario 2: 1 MONEY_TRANSFER $100, commission $8 → Bank: +100, Cash: -8', async () => {
      const initialCashBalance = await getBalance(prisma, testEnv.cashAccount.id)
      const initialBankBalance = await getBalance(prisma, testEnv.bankAccount.id)

      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 0,
        bankPaidAmount: 100,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'MONEY_TRANSFER',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      await assertBalance(
        prisma,
        testEnv.bankAccount.id,
        initialBankBalance + 100,
        'Bank should increase by 100 (transfer payment)'
      )

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        initialCashBalance - 8,
        'Cash should decrease by 8 (commission always from cash)'
      )
    })

    it('Scenario 3: 2 CASH payments $100 each, commission $8 each → Cash: +184', async () => {
      // Create a second loan for the second payment
      const loan2 = await createTestLoan(
        prisma,
        testEnv.borrower.id,
        testEnv.loantype.id,
        testEnv.lead.id
      )

      const initialBalance = await getBalance(prisma, testEnv.cashAccount.id)

      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 200,
        paidAmount: 200,
        cashPaidAmount: 184, // (100-8) + (100-8)
        bankPaidAmount: 0,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
          {
            loanId: loan2.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        initialBalance + 184,
        'Cash should increase by 184 (2 × (100 - 8))'
      )
    })

    it('Scenario 4: 1 CASH + 1 MONEY_TRANSFER → Cash: +92, Bank: +100', async () => {
      const loan2 = await createTestLoan(
        prisma,
        testEnv.borrower.id,
        testEnv.loantype.id,
        testEnv.lead.id
      )

      const initialCashBalance = await getBalance(prisma, testEnv.cashAccount.id)
      const initialBankBalance = await getBalance(prisma, testEnv.bankAccount.id)

      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 200,
        paidAmount: 200,
        cashPaidAmount: 92, // CASH payment - its commission
        bankPaidAmount: 100, // MONEY_TRANSFER goes to bank
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
          {
            loanId: loan2.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'MONEY_TRANSFER',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        initialCashBalance + 92 - 8, // +92 from CASH payment, -8 commission from transfer
        'Cash should increase by 84 (92 from cash payment - 8 commission from transfer)'
      )

      await assertBalance(
        prisma,
        testEnv.bankAccount.id,
        initialBankBalance + 100,
        'Bank should increase by 100'
      )
    })

    it('Scenario 5: 1 payment without commission → Cash: +100', async () => {
      const initialBalance = await getBalance(prisma, testEnv.cashAccount.id)

      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 100, // No commission
        bankPaidAmount: 0,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 0, // No commission
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        initialBalance + 100,
        'Cash should increase by 100 (no commission)'
      )
    })
  })

  // ===========================================
  // B. DISTRIBUCIÓN (TRANSFER)
  // ===========================================

  describe('B. Distribution (TRANSFER)', () => {
    it('Scenario 6: CASH payment $100, 100% to bank → Cash: 0, Bank: +92', async () => {
      const initialCashBalance = await getBalance(prisma, testEnv.cashAccount.id)
      const initialBankBalance = await getBalance(prisma, testEnv.bankAccount.id)

      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 0, // All to bank
        bankPaidAmount: 92, // 100 - 8 commission
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        initialCashBalance,
        'Cash should stay at 0 (payment came in cash but was transferred to bank)'
      )

      await assertBalance(
        prisma,
        testEnv.bankAccount.id,
        initialBankBalance + 92,
        'Bank should increase by 92'
      )
    })

    it('Scenario 7: CASH payment $100, 50/50 split → Cash: +46, Bank: +46', async () => {
      const initialCashBalance = await getBalance(prisma, testEnv.cashAccount.id)
      const initialBankBalance = await getBalance(prisma, testEnv.bankAccount.id)

      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 46, // Half of 92
        bankPaidAmount: 46, // Half of 92
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        initialCashBalance + 46,
        'Cash should increase by 46'
      )

      await assertBalance(
        prisma,
        testEnv.bankAccount.id,
        initialBankBalance + 46,
        'Bank should increase by 46'
      )
    })

    it('Scenario 8: Change distribution 100% cash to 100% bank → Cash: -92, Bank: +92', async () => {
      // First create with 100% cash
      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 92,
        bankPaidAmount: 0,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      const cashAfterCreate = await getBalance(prisma, testEnv.cashAccount.id)
      const bankAfterCreate = await getBalance(prisma, testEnv.bankAccount.id)

      expect(cashAfterCreate).toBe(92)
      expect(bankAfterCreate).toBe(0)

      // Now change distribution to 100% bank
      await paymentService.updateLeadPaymentReceived(result.id, {
        distributionOnlyChange: true,
        cashPaidAmount: 0,
        bankPaidAmount: 92,
      })

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        0,
        'Cash should be 0 after moving all to bank'
      )

      await assertBalance(
        prisma,
        testEnv.bankAccount.id,
        92,
        'Bank should be 92 after receiving transfer'
      )
    })

    it('Scenario 9: Change distribution 100% bank to 100% cash → Cash: +92, Bank: -92', async () => {
      // First create with 100% bank
      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 0,
        bankPaidAmount: 92,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      const cashAfterCreate = await getBalance(prisma, testEnv.cashAccount.id)
      const bankAfterCreate = await getBalance(prisma, testEnv.bankAccount.id)

      expect(cashAfterCreate).toBe(0)
      expect(bankAfterCreate).toBe(92)

      // Now change distribution to 100% cash
      await paymentService.updateLeadPaymentReceived(result.id, {
        distributionOnlyChange: true,
        cashPaidAmount: 92,
        bankPaidAmount: 0,
      })

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        92,
        'Cash should be 92 after getting all'
      )

      await assertBalance(
        prisma,
        testEnv.bankAccount.id,
        0,
        'Bank should be 0 after transfer back to cash'
      )
    })
  })

  // ===========================================
  // C. EDITAR PAGOS
  // ===========================================

  describe('C. Edit Payments', () => {
    it('Scenario 10: Edit amount $100→$150 → Cash: +50 additional', async () => {
      // Create payment with $100
      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 92, // 100 - 8 commission
        bankPaidAmount: 0,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      const cashAfterCreate = await getBalance(prisma, testEnv.cashAccount.id)
      expect(cashAfterCreate).toBe(92)

      // Get the payment ID
      const loanPayments = await prisma.loanPayment.findMany({
        where: { leadPaymentReceived: result.id },
      })

      // Edit: increase amount to $150 (commission stays 8%)
      // New commission = 150 * 0.08 = 12
      await paymentService.updateLeadPaymentReceived(result.id, {
        expectedAmount: 150,
        paidAmount: 150,
        cashPaidAmount: 138, // 150 - 12
        bankPaidAmount: 0,
        payments: [
          {
            paymentId: loanPayments[0].id,
            loanId: testEnv.loan.id,
            amount: 150,
            comission: 12,
            paymentMethod: 'CASH',
          },
        ],
      })

      // 150 - 12 = 138 (new)
      // Was 92, so delta = 138 - 92 = +46
      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        138,
        'Cash should be 138 after editing amount from 100 to 150'
      )
    })

    it('Scenario 11: Edit commission $8→$0 → Cash: +8 additional', async () => {
      // Create payment with commission
      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 92,
        bankPaidAmount: 0,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      const cashAfterCreate = await getBalance(prisma, testEnv.cashAccount.id)
      expect(cashAfterCreate).toBe(92)

      // Get the payment ID
      const loanPayments = await prisma.loanPayment.findMany({
        where: { leadPaymentReceived: result.id },
      })

      // Edit: remove commission
      await paymentService.updateLeadPaymentReceived(result.id, {
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 100, // No commission now
        bankPaidAmount: 0,
        payments: [
          {
            paymentId: loanPayments[0].id,
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 0, // No commission
            paymentMethod: 'CASH',
          },
        ],
      })

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        100,
        'Cash should be 100 after removing commission'
      )
    })

    it('Scenario 12: Edit commission $0→$8 → Cash: -8', async () => {
      // Create payment without commission
      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 100, // No commission
        bankPaidAmount: 0,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 0,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      const cashAfterCreate = await getBalance(prisma, testEnv.cashAccount.id)
      expect(cashAfterCreate).toBe(100)

      // Get the payment ID
      const loanPayments = await prisma.loanPayment.findMany({
        where: { leadPaymentReceived: result.id },
      })

      // Edit: add commission
      await paymentService.updateLeadPaymentReceived(result.id, {
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 92, // Now with commission
        bankPaidAmount: 0,
        payments: [
          {
            paymentId: loanPayments[0].id,
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8, // Added commission
            paymentMethod: 'CASH',
          },
        ],
      })

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        92,
        'Cash should be 92 after adding commission'
      )
    })

    it('Scenario 13: Change method CASH→MONEY_TRANSFER → Cash: -100, Bank: +100', async () => {
      // Create CASH payment
      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 92,
        bankPaidAmount: 0,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      const cashAfterCreate = await getBalance(prisma, testEnv.cashAccount.id)
      const bankAfterCreate = await getBalance(prisma, testEnv.bankAccount.id)
      expect(cashAfterCreate).toBe(92)
      expect(bankAfterCreate).toBe(0)

      // Get the payment ID
      const loanPayments = await prisma.loanPayment.findMany({
        where: { leadPaymentReceived: result.id },
      })

      // Edit: change to MONEY_TRANSFER
      await paymentService.updateLeadPaymentReceived(result.id, {
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 0, // Commission still applies but from cash
        bankPaidAmount: 100,
        payments: [
          {
            paymentId: loanPayments[0].id,
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'MONEY_TRANSFER',
          },
        ],
      })

      // After change: Bank gets 100, Cash pays 8 commission
      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        -8,
        'Cash should be -8 (only commission) after changing to MONEY_TRANSFER'
      )

      await assertBalance(
        prisma,
        testEnv.bankAccount.id,
        100,
        'Bank should be 100 after changing to MONEY_TRANSFER'
      )
    })

    it('Scenario 14: Change method MONEY_TRANSFER→CASH → Cash: +100, Bank: -100', async () => {
      // Create MONEY_TRANSFER payment
      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 0,
        bankPaidAmount: 100,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'MONEY_TRANSFER',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      const cashAfterCreate = await getBalance(prisma, testEnv.cashAccount.id)
      const bankAfterCreate = await getBalance(prisma, testEnv.bankAccount.id)
      expect(cashAfterCreate).toBe(-8) // Commission from cash
      expect(bankAfterCreate).toBe(100)

      // Get the payment ID
      const loanPayments = await prisma.loanPayment.findMany({
        where: { leadPaymentReceived: result.id },
      })

      // Edit: change to CASH
      await paymentService.updateLeadPaymentReceived(result.id, {
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 92, // Now cash with commission
        bankPaidAmount: 0,
        payments: [
          {
            paymentId: loanPayments[0].id,
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      // After change: Cash gets 100 - 8 = 92, Bank goes to 0
      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        92,
        'Cash should be 92 after changing to CASH'
      )

      await assertBalance(
        prisma,
        testEnv.bankAccount.id,
        0,
        'Bank should be 0 after changing to CASH'
      )
    })
  })

  // ===========================================
  // D. ELIMINAR PAGOS
  // ===========================================

  describe('D. Delete Payments', () => {
    it('Scenario 15: Delete 1 payment (the only one) → Reverses balance to 0', async () => {
      // Create payment
      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 92,
        bankPaidAmount: 0,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      const cashAfterCreate = await getBalance(prisma, testEnv.cashAccount.id)
      expect(cashAfterCreate).toBe(92)

      // Get the payment ID from the database
      const loanPayments = await prisma.loanPayment.findMany({
        where: { leadPaymentReceived: result.id },
      })
      const paymentId = loanPayments[0].id

      // Delete the payment
      await paymentService.updateLeadPaymentReceived(result.id, {
        payments: [
          {
            paymentId,
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
            isDeleted: true,
          },
        ],
      })

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        0,
        'Cash should return to 0 after deleting the only payment'
      )
    })

    it('Scenario 17: Delete all payments → Balance returns to 0', async () => {
      const loan2 = await createTestLoan(
        prisma,
        testEnv.borrower.id,
        testEnv.loantype.id,
        testEnv.lead.id
      )

      // Create with 2 payments
      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 200,
        paidAmount: 200,
        cashPaidAmount: 184,
        bankPaidAmount: 0,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
          {
            loanId: loan2.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      const cashAfterCreate = await getBalance(prisma, testEnv.cashAccount.id)
      expect(cashAfterCreate).toBe(184)

      // Get the payment IDs from the database
      const loanPayments = await prisma.loanPayment.findMany({
        where: { leadPaymentReceived: result.id },
        orderBy: { createdAt: 'asc' },
      })

      // Delete both payments
      await paymentService.updateLeadPaymentReceived(result.id, {
        payments: [
          {
            paymentId: loanPayments[0].id,
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
            isDeleted: true,
          },
          {
            paymentId: loanPayments[1].id,
            loanId: loan2.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
            isDeleted: true,
          },
        ],
      })

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        0,
        'Cash should return to 0 after deleting all payments'
      )
    })

    it('Scenario 18: Delete payment with TRANSFER active → Reverses both cash and bank', async () => {
      // Create payment with 100% to bank
      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 0,
        bankPaidAmount: 92,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      const cashAfterCreate = await getBalance(prisma, testEnv.cashAccount.id)
      const bankAfterCreate = await getBalance(prisma, testEnv.bankAccount.id)

      expect(cashAfterCreate).toBe(0)
      expect(bankAfterCreate).toBe(92)

      // Get the payment ID from the database
      const loanPayments = await prisma.loanPayment.findMany({
        where: { leadPaymentReceived: result.id },
      })

      // Delete the payment
      await paymentService.updateLeadPaymentReceived(result.id, {
        payments: [
          {
            paymentId: loanPayments[0].id,
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
            isDeleted: true,
          },
        ],
      })

      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        0,
        'Cash should be 0 after deleting payment (was already 0)'
      )

      await assertBalance(
        prisma,
        testEnv.bankAccount.id,
        0,
        'Bank should return to 0 after deleting payment with TRANSFER'
      )
    })
  })

  // ===========================================
  // F. FLUJOS COMBINADOS (Los que están fallando)
  // ===========================================

  describe('F. Combined Flows (Critical Bug Scenarios)', () => {
    it('Scenario 22: Create payments → Edit distribution → Delete all → Balance: 0', async () => {
      // Step 1: Create payment with 100% cash
      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 92,
        bankPaidAmount: 0,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      let cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
      let bankBalance = await getBalance(prisma, testEnv.bankAccount.id)
      expect(cashBalance).toBe(92)
      expect(bankBalance).toBe(0)

      // Step 2: Change distribution to 100% bank (set TRANSFER = 92)
      await paymentService.updateLeadPaymentReceived(result.id, {
        distributionOnlyChange: true,
        cashPaidAmount: 0,
        bankPaidAmount: 92,
      })

      cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
      bankBalance = await getBalance(prisma, testEnv.bankAccount.id)
      expect(cashBalance).toBe(0)
      expect(bankBalance).toBe(92)

      // Get the payment ID from the database
      const loanPayments = await prisma.loanPayment.findMany({
        where: { leadPaymentReceived: result.id },
      })

      // Step 3: Delete the payment
      await paymentService.updateLeadPaymentReceived(result.id, {
        payments: [
          {
            paymentId: loanPayments[0].id,
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
            isDeleted: true,
          },
        ],
      })

      // EXPECTED: Both balances should be 0
      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        0,
        'Cash should be 0 after full cycle'
      )

      await assertBalance(
        prisma,
        testEnv.bankAccount.id,
        0,
        'Bank should be 0 after full cycle'
      )
    })

    it('Scenario 22b: Create → Set TRANSFER to 100 (invalid) → Delete all → Balance: 0', async () => {
      // This tests the bug where TRANSFER was set to 100 but only 92 was available
      const result = await paymentService.createLeadPaymentReceived({
        leadId: testEnv.lead.id,
        agentId: testEnv.agent.id,
        expectedAmount: 100,
        paidAmount: 100,
        cashPaidAmount: 92,
        bankPaidAmount: 0,
        paymentDate: new Date(),
        payments: [
          {
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
          },
        ],
      })

      trackLeadPaymentReceived(result.id)

      // Try to set TRANSFER = 100 (more than available 92)
      // The system should handle this gracefully
      await paymentService.updateLeadPaymentReceived(result.id, {
        distributionOnlyChange: true,
        cashPaidAmount: 0,
        bankPaidAmount: 100, // This is invalid - only 92 available after commission
      })

      // Get the payment ID from the database
      const loanPayments = await prisma.loanPayment.findMany({
        where: { leadPaymentReceived: result.id },
      })

      // Delete the payment
      await paymentService.updateLeadPaymentReceived(result.id, {
        payments: [
          {
            paymentId: loanPayments[0].id,
            loanId: testEnv.loan.id,
            amount: 100,
            comission: 8,
            paymentMethod: 'CASH',
            isDeleted: true,
          },
        ],
      })

      // EXPECTED: Both balances should be 0 (no 8 peso discrepancy!)
      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        0,
        'Cash should be 0 - no commission discrepancy'
      )

      await assertBalance(
        prisma,
        testEnv.bankAccount.id,
        0,
        'Bank should be 0'
      )
    })
  })
})
