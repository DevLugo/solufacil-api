import { describe, it, expect, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'
import { prisma, testData } from './setup'
import {
  createTestRoute,
  createTestAccount,
  createTestEmployee,
  createTestBorrower,
  createTestLoantype,
  assertBalance,
  getBalance,
} from './helpers'
import { LoanService } from '../LoanService'

describe('LoanService Balance Tests', () => {
  let loanService: LoanService
  let testEnv: {
    route: Awaited<ReturnType<typeof createTestRoute>>
    cashAccount: Awaited<ReturnType<typeof createTestAccount>>
    lead: Awaited<ReturnType<typeof createTestEmployee>>
    grantor: Awaited<ReturnType<typeof createTestEmployee>>
    borrower: Awaited<ReturnType<typeof createTestBorrower>>
    loantype: Awaited<ReturnType<typeof createTestLoantype>>
  }

  beforeEach(async () => {
    loanService = new LoanService(prisma)

    // Create route
    const route = await createTestRoute(prisma)

    // Create cash account with initial balance (need funds to create loans)
    const cashAccount = await createTestAccount(prisma, route.id, {
      type: 'EMPLOYEE_CASH_FUND',
      name: 'Test Cash Account',
      balance: 10000, // Start with 10,000 to have enough funds
    })

    // Create lead and grantor
    const lead = await createTestEmployee(prisma, route.id, {
      type: 'LEAD',
      name: 'Test Lead',
    })

    const grantor = await createTestEmployee(prisma, route.id, {
      type: 'ROUTE_LEAD',
      name: 'Test Grantor',
    })

    // Create borrower
    const borrower = await createTestBorrower(prisma)

    // Create loantype
    const loantype = await createTestLoantype(prisma, {
      weekDuration: 10,
      rate: 0.2,
      loanPaymentComission: 8, // 8% commission on payments
      loanGrantedComission: 50, // $50 fixed commission for granting loan
    })

    testEnv = {
      route,
      cashAccount,
      lead,
      grantor,
      borrower,
      loantype,
    }
  })

  // ===========================================
  // E. CREAR CRÉDITOS
  // ===========================================

  describe('E. Create Loans', () => {
    it('Scenario 19: Create loan $1000, commission $50 → Cash: -1050', async () => {
      const initialBalance = await getBalance(prisma, testEnv.cashAccount.id)
      expect(initialBalance).toBe(10000)

      // Create a single loan
      const createdLoans = await loanService.createLoansInBatch({
        sourceAccountId: testEnv.cashAccount.id,
        signDate: new Date(),
        leadId: testEnv.lead.id,
        grantorId: testEnv.grantor.id,
        loans: [
          {
            tempId: 'temp-1',
            requestedAmount: 1000,
            amountGived: 1000,
            loantypeId: testEnv.loantype.id,
            comissionAmount: 50,
            borrowerId: testEnv.borrower.id,
          },
        ],
      })

      // Track created loan for cleanup
      if (createdLoans.length > 0) {
        testData.loanIds.push(createdLoans[0].id)
      }

      // Balance should decrease by 1000 (loan) + 50 (commission) = 1050
      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        10000 - 1050,
        'Cash should decrease by 1050 (1000 loan + 50 commission)'
      )
    })

    it('Scenario 20: Create loan $1000 with first payment $100 → Cash: -958', async () => {
      const initialBalance = await getBalance(prisma, testEnv.cashAccount.id)
      expect(initialBalance).toBe(10000)

      // Create loan with first payment
      const createdLoans = await loanService.createLoansInBatch({
        sourceAccountId: testEnv.cashAccount.id,
        signDate: new Date(),
        leadId: testEnv.lead.id,
        grantorId: testEnv.grantor.id,
        loans: [
          {
            tempId: 'temp-1',
            requestedAmount: 1000,
            amountGived: 1000,
            loantypeId: testEnv.loantype.id,
            comissionAmount: 50,
            borrowerId: testEnv.borrower.id,
            firstPayment: {
              amount: 100,
              comission: 8, // 8% of 100
              paymentMethod: 'CASH',
            },
          },
        ],
      })

      // Track created loan for cleanup
      if (createdLoans.length > 0) {
        testData.loanIds.push(createdLoans[0].id)
      }

      // Balance calculation:
      // -1000 (loan given)
      // -50 (loan commission)
      // +100 (first payment received)
      // -8 (payment commission)
      // = 10000 - 1000 - 50 + 100 - 8 = 9042
      // Net effect = -958
      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        10000 - 958,
        'Cash should be 9042 (10000 - 1050 + 92)'
      )
    })

    it('Scenario 21: Create 2 loans in batch → Cash: -(sum of both)', async () => {
      // Create a second borrower
      const borrower2 = await createTestBorrower(prisma, { name: 'Borrower 2' })

      const initialBalance = await getBalance(prisma, testEnv.cashAccount.id)
      expect(initialBalance).toBe(10000)

      // Create 2 loans in batch
      const createdLoans = await loanService.createLoansInBatch({
        sourceAccountId: testEnv.cashAccount.id,
        signDate: new Date(),
        leadId: testEnv.lead.id,
        grantorId: testEnv.grantor.id,
        loans: [
          {
            tempId: 'temp-1',
            requestedAmount: 1000,
            amountGived: 1000,
            loantypeId: testEnv.loantype.id,
            comissionAmount: 50,
            borrowerId: testEnv.borrower.id,
          },
          {
            tempId: 'temp-2',
            requestedAmount: 2000,
            amountGived: 2000,
            loantypeId: testEnv.loantype.id,
            comissionAmount: 100,
            borrowerId: borrower2.id,
          },
        ],
      })

      // Track created loans for cleanup
      for (const loan of createdLoans) {
        testData.loanIds.push(loan.id)
      }

      // Balance should decrease by:
      // Loan 1: 1000 + 50 = 1050
      // Loan 2: 2000 + 100 = 2100
      // Total: 3150
      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        10000 - 3150,
        'Cash should decrease by 3150 (sum of both loans + commissions)'
      )
    })

    it('Scenario 21b: Create 2 loans with first payments in batch', async () => {
      // Create a second borrower
      const borrower2 = await createTestBorrower(prisma, { name: 'Borrower 2' })

      const initialBalance = await getBalance(prisma, testEnv.cashAccount.id)
      expect(initialBalance).toBe(10000)

      // Create 2 loans in batch with first payments
      const createdLoans = await loanService.createLoansInBatch({
        sourceAccountId: testEnv.cashAccount.id,
        signDate: new Date(),
        leadId: testEnv.lead.id,
        grantorId: testEnv.grantor.id,
        loans: [
          {
            tempId: 'temp-1',
            requestedAmount: 1000,
            amountGived: 1000,
            loantypeId: testEnv.loantype.id,
            comissionAmount: 50,
            borrowerId: testEnv.borrower.id,
            firstPayment: {
              amount: 100,
              comission: 8,
              paymentMethod: 'CASH',
            },
          },
          {
            tempId: 'temp-2',
            requestedAmount: 2000,
            amountGived: 2000,
            loantypeId: testEnv.loantype.id,
            comissionAmount: 100,
            borrowerId: borrower2.id,
            firstPayment: {
              amount: 200,
              comission: 16,
              paymentMethod: 'CASH',
            },
          },
        ],
      })

      // Track created loans for cleanup
      for (const loan of createdLoans) {
        testData.loanIds.push(loan.id)
      }

      // Balance calculation:
      // Loan 1: -1000 - 50 + 100 - 8 = -958
      // Loan 2: -2000 - 100 + 200 - 16 = -1916
      // Total: -2874
      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        10000 - 2874,
        'Cash should be 7126 (10000 - 2874)'
      )
    })
  })

  // ===========================================
  // CANCEL LOAN WITH RESTORE
  // ===========================================

  describe('Cancel Loan', () => {
    it('Cancel loan restores balance correctly', async () => {
      const initialBalance = await getBalance(prisma, testEnv.cashAccount.id)

      // Create a loan
      const createdLoans = await loanService.createLoansInBatch({
        sourceAccountId: testEnv.cashAccount.id,
        signDate: new Date(),
        leadId: testEnv.lead.id,
        grantorId: testEnv.grantor.id,
        loans: [
          {
            tempId: 'temp-1',
            requestedAmount: 1000,
            amountGived: 1000,
            loantypeId: testEnv.loantype.id,
            comissionAmount: 50,
            borrowerId: testEnv.borrower.id,
          },
        ],
      })

      const loanId = createdLoans[0].id
      testData.loanIds.push(loanId)

      // Verify balance decreased
      const balanceAfterCreate = await getBalance(prisma, testEnv.cashAccount.id)
      expect(balanceAfterCreate).toBe(initialBalance - 1050)

      // Cancel the loan with account restore
      await loanService.cancelLoanWithAccountRestore(loanId, testEnv.cashAccount.id)

      // Balance should be restored
      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        initialBalance,
        'Cash should be restored to initial balance after cancelling loan'
      )
    })

    it('Cancel loan with first payment restores balance correctly', async () => {
      const initialBalance = await getBalance(prisma, testEnv.cashAccount.id)

      // Create a loan with first payment
      const createdLoans = await loanService.createLoansInBatch({
        sourceAccountId: testEnv.cashAccount.id,
        signDate: new Date(),
        leadId: testEnv.lead.id,
        grantorId: testEnv.grantor.id,
        loans: [
          {
            tempId: 'temp-1',
            requestedAmount: 1000,
            amountGived: 1000,
            loantypeId: testEnv.loantype.id,
            comissionAmount: 50,
            borrowerId: testEnv.borrower.id,
            firstPayment: {
              amount: 100,
              comission: 8,
              paymentMethod: 'CASH',
            },
          },
        ],
      })

      const loanId = createdLoans[0].id
      testData.loanIds.push(loanId)

      // Verify balance: -1000 - 50 + 100 - 8 = -958
      const balanceAfterCreate = await getBalance(prisma, testEnv.cashAccount.id)
      expect(balanceAfterCreate).toBe(initialBalance - 958)

      // Cancel the loan with account restore
      await loanService.cancelLoanWithAccountRestore(loanId, testEnv.cashAccount.id)

      // Balance should be restored (loan amount + commission - payment + payment commission)
      // Restored: +1000 + 50 - 100 + 8 = +958
      await assertBalance(
        prisma,
        testEnv.cashAccount.id,
        initialBalance,
        'Cash should be restored to initial balance after cancelling loan with first payment'
      )
    })
  })
})
