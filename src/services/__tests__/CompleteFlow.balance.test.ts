import { describe, it, expect, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'
import { prisma, testData } from './setup'
import {
  createTestRoute,
  createTestAccount,
  createTestEmployee,
  createTestBorrower,
  createTestLoantype,
  createTestLoan,
  assertBalance,
  getBalance,
  trackLeadPaymentReceived,
} from './helpers'
import { PaymentService } from '../PaymentService'
import { LoanService } from '../LoanService'

/**
 * COMPLETE FLOW TEST - Bug Reproduction
 *
 * This test reproduces the scenario where:
 * 1. Start with 50k cash, 100k bank
 * 2. Create payments with different methods
 * 3. Use distribution modal with transfer
 * 4. Renew loans with first payment
 * 5. Revert all payments
 * 6. Delete renewed loans
 * 7. Balance should return to initial state but doesn't
 */
describe('Complete Flow Balance Test - Bug Reproduction', () => {
  let paymentService: PaymentService
  let loanService: LoanService
  let testEnv: {
    route: Awaited<ReturnType<typeof createTestRoute>>
    cashAccount: Awaited<ReturnType<typeof createTestAccount>>
    bankAccount: Awaited<ReturnType<typeof createTestAccount>>
    lead: Awaited<ReturnType<typeof createTestEmployee>>
    grantor: Awaited<ReturnType<typeof createTestEmployee>>
    loantype: Awaited<ReturnType<typeof createTestLoantype>>
    borrowers: Awaited<ReturnType<typeof createTestBorrower>>[]
    loans: Awaited<ReturnType<typeof createTestLoan>>[]
  }

  const INITIAL_CASH_BALANCE = 50000
  const INITIAL_BANK_BALANCE = 100000

  beforeEach(async () => {
    paymentService = new PaymentService(prisma)
    loanService = new LoanService(prisma)

    // Create route
    const route = await createTestRoute(prisma)

    // Create accounts with initial balances
    const cashAccount = await createTestAccount(prisma, route.id, {
      type: 'EMPLOYEE_CASH_FUND',
      name: 'Caja Principal',
      balance: INITIAL_CASH_BALANCE,
    })

    const bankAccount = await createTestAccount(prisma, route.id, {
      type: 'BANK',
      name: 'Banco Principal',
      balance: INITIAL_BANK_BALANCE,
    })

    // Create employees
    const lead = await createTestEmployee(prisma, route.id, {
      type: 'LEAD',
      name: 'Lead Test',
    })

    const grantor = await createTestEmployee(prisma, route.id, {
      type: 'ROUTE_LEAD',
      name: 'Grantor Test',
    })

    // Create loantype (10 weeks, 20% rate, 8% payment commission, $50 grant commission)
    const loantype = await createTestLoantype(prisma, {
      weekDuration: 10,
      rate: 0.20,
      loanPaymentComission: 8,
      loanGrantedComission: 50,
    })

    // Create 5 borrowers with active loans
    const borrowers: Awaited<ReturnType<typeof createTestBorrower>>[] = []
    const loans: Awaited<ReturnType<typeof createTestLoan>>[] = []

    for (let i = 0; i < 5; i++) {
      const borrower = await createTestBorrower(prisma, { name: `Borrower ${i + 1}` })
      borrowers.push(borrower)

      // Each loan is $1000 with $200 profit = $1200 total debt
      const loan = await createTestLoan(prisma, borrower.id, loantype.id, lead.id, {
        amountGived: 1000,
        profitAmount: 200,
        totalDebtAcquired: 1200,
        expectedWeeklyPayment: 120, // $1200 / 10 weeks
        pendingAmountStored: 1200,
        status: 'ACTIVE',
      })
      loans.push(loan)
    }

    testEnv = {
      route,
      cashAccount,
      bankAccount,
      lead,
      grantor,
      loantype,
      borrowers,
      loans,
    }
  })

  it('Complete scenario: Payments → Renewals → Revert → Delete should restore balance', async () => {
    // ========================================
    // STEP 1: Verify initial balances
    // ========================================
    console.log('\n=== STEP 1: Verify initial balances ===')

    let cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    let bankBalance = await getBalance(prisma, testEnv.bankAccount.id)

    expect(cashBalance).toBe(INITIAL_CASH_BALANCE)
    expect(bankBalance).toBe(INITIAL_BANK_BALANCE)

    console.log(`Initial Cash: ${cashBalance}`)
    console.log(`Initial Bank: ${bankBalance}`)

    // ========================================
    // STEP 2 & 3: Create payments
    // - 2 loans marked as "falta" (no payment) - we simply don't include them
    // - 1 loan as MONEY_TRANSFER
    // - 2 loans as CASH
    // ========================================
    console.log('\n=== STEP 2 & 3: Create payments ===')

    // Payment amounts: $120 each (weekly payment)
    // Commission: 8% = $9.60, rounded to $10 for simplicity
    const paymentAmount = 120
    const commission = 10 // 8% of 120 ≈ 9.6, using 10

    // Create payment with:
    // - Loan 0: MONEY_TRANSFER ($120)
    // - Loan 1: CASH ($120)
    // - Loan 2: CASH ($120)
    // - Loan 3 & 4: No payment (falta)

    const leadPaymentResult = await paymentService.createLeadPaymentReceived({
      leadId: testEnv.lead.id,
      agentId: testEnv.grantor.id,
      expectedAmount: paymentAmount * 3, // 3 payments
      paidAmount: paymentAmount * 3,
      cashPaidAmount: (paymentAmount - commission) * 2 - 100, // 2 CASH payments minus commission, minus 100 for transfer
      bankPaidAmount: paymentAmount + 100, // MONEY_TRANSFER + 100 from distribution
      paymentDate: new Date('2024-01-15'), // Fixed date in the past
      payments: [
        {
          loanId: testEnv.loans[0].id,
          amount: paymentAmount,
          comission: commission,
          paymentMethod: 'MONEY_TRANSFER',
        },
        {
          loanId: testEnv.loans[1].id,
          amount: paymentAmount,
          comission: commission,
          paymentMethod: 'CASH',
        },
        {
          loanId: testEnv.loans[2].id,
          amount: paymentAmount,
          comission: commission,
          paymentMethod: 'CASH',
        },
      ],
    })

    trackLeadPaymentReceived(leadPaymentResult.id)

    cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    bankBalance = await getBalance(prisma, testEnv.bankAccount.id)

    console.log(`After payments - Cash: ${cashBalance}`)
    console.log(`After payments - Bank: ${bankBalance}`)

    const cashAfterPayments = cashBalance
    const bankAfterPayments = bankBalance

    // ========================================
    // STEP 5: Renew first loan for $4000 with first payment
    // ========================================
    console.log('\n=== STEP 5: Renew first loan for $4000 ===')

    // First, we need to finish the existing loan
    await prisma.loan.update({
      where: { id: testEnv.loans[0].id },
      data: { status: 'FINISHED', finishedDate: new Date() },
    })

    const renewedLoans1 = await loanService.createLoansInBatch({
      sourceAccountId: testEnv.cashAccount.id,
      signDate: new Date('2024-01-15'),
      leadId: testEnv.lead.id,
      grantorId: testEnv.grantor.id,
      loans: [
        {
          tempId: 'renew-1',
          requestedAmount: 4000,
          amountGived: 4000,
          loantypeId: testEnv.loantype.id,
          comissionAmount: 50, // Grant commission
          borrowerId: testEnv.borrowers[0].id,
          previousLoanId: testEnv.loans[0].id,
          firstPayment: {
            amount: 480, // 4000 * 1.2 / 10 = 480 weekly payment
            comission: 38, // 8% of 480
            paymentMethod: 'CASH',
          },
        },
      ],
    })

    testData.loanIds.push(renewedLoans1[0].id)

    cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    bankBalance = await getBalance(prisma, testEnv.bankAccount.id)

    console.log(`After renewal 1 - Cash: ${cashBalance}`)
    console.log(`After renewal 1 - Bank: ${bankBalance}`)

    // ========================================
    // STEP 6: Renew second loan for $4000 with first payment
    // ========================================
    console.log('\n=== STEP 6: Renew second loan for $4000 ===')

    // Finish the existing loan
    await prisma.loan.update({
      where: { id: testEnv.loans[1].id },
      data: { status: 'FINISHED', finishedDate: new Date() },
    })

    const renewedLoans2 = await loanService.createLoansInBatch({
      sourceAccountId: testEnv.cashAccount.id,
      signDate: new Date('2024-01-15'),
      leadId: testEnv.lead.id,
      grantorId: testEnv.grantor.id,
      loans: [
        {
          tempId: 'renew-2',
          requestedAmount: 4000,
          amountGived: 4000,
          loantypeId: testEnv.loantype.id,
          comissionAmount: 50,
          borrowerId: testEnv.borrowers[1].id,
          previousLoanId: testEnv.loans[1].id,
          firstPayment: {
            amount: 480,
            comission: 38,
            paymentMethod: 'CASH',
          },
        },
      ],
    })

    testData.loanIds.push(renewedLoans2[0].id)

    cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    bankBalance = await getBalance(prisma, testEnv.bankAccount.id)

    console.log(`After renewal 2 - Cash: ${cashBalance}`)
    console.log(`After renewal 2 - Bank: ${bankBalance}`)

    const cashAfterRenewals = cashBalance
    const bankAfterRenewals = bankBalance

    // ========================================
    // STEP 7: Revert all payments (mark as no payment)
    // ========================================
    console.log('\n=== STEP 7: Revert all payments ===')

    // Get the loan payments from the LeadPaymentReceived
    const loanPayments = await prisma.loanPayment.findMany({
      where: { leadPaymentReceived: leadPaymentResult.id },
    })

    // Delete all payments by marking them as deleted
    await paymentService.updateLeadPaymentReceived(leadPaymentResult.id, {
      cashPaidAmount: 0,
      bankPaidAmount: 0,
      payments: loanPayments.map(p => ({
        paymentId: p.id,
        loanId: p.loan,
        amount: new Decimal(p.amount.toString()).toNumber(),
        comission: new Decimal(p.comission.toString()).toNumber(),
        paymentMethod: p.paymentMethod,
        isDeleted: true,
      })),
    })

    cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    bankBalance = await getBalance(prisma, testEnv.bankAccount.id)

    console.log(`After reverting payments - Cash: ${cashBalance}`)
    console.log(`After reverting payments - Bank: ${bankBalance}`)

    // ========================================
    // STEP 8: Delete the 2 renewed loans
    // ========================================
    console.log('\n=== STEP 8: Delete renewed loans ===')

    // Cancel loan 1 with account restore
    await loanService.cancelLoanWithAccountRestore(renewedLoans1[0].id, testEnv.cashAccount.id)

    cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`After canceling renewal 1 - Cash: ${cashBalance}`)

    // Cancel loan 2 with account restore
    await loanService.cancelLoanWithAccountRestore(renewedLoans2[0].id, testEnv.cashAccount.id)

    cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    bankBalance = await getBalance(prisma, testEnv.bankAccount.id)

    console.log(`After canceling renewal 2 - Cash: ${cashBalance}`)
    console.log(`After canceling renewal 2 - Bank: ${bankBalance}`)

    // ========================================
    // STEP 9: Verify final balances match initial
    // ========================================
    console.log('\n=== STEP 9: Verify final balances ===')

    const finalCashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    const finalBankBalance = await getBalance(prisma, testEnv.bankAccount.id)

    console.log(`\n========================================`)
    console.log(`BALANCE COMPARISON:`)
    console.log(`========================================`)
    console.log(`Initial Cash: ${INITIAL_CASH_BALANCE}`)
    console.log(`Final Cash:   ${finalCashBalance}`)
    console.log(`Cash Diff:    ${finalCashBalance - INITIAL_CASH_BALANCE}`)
    console.log(`----------------------------------------`)
    console.log(`Initial Bank: ${INITIAL_BANK_BALANCE}`)
    console.log(`Final Bank:   ${finalBankBalance}`)
    console.log(`Bank Diff:    ${finalBankBalance - INITIAL_BANK_BALANCE}`)
    console.log(`========================================\n`)

    // THE BUG: These assertions should pass but currently fail
    // because the balance is not properly restored
    await assertBalance(
      prisma,
      testEnv.cashAccount.id,
      INITIAL_CASH_BALANCE,
      `Cash should return to initial ${INITIAL_CASH_BALANCE} after all reversals`
    )

    await assertBalance(
      prisma,
      testEnv.bankAccount.id,
      INITIAL_BANK_BALANCE,
      `Bank should return to initial ${INITIAL_BANK_BALANCE} after all reversals`
    )
  })

  it('Simpler scenario: Create payment with transfer → Delete → Balance restored', async () => {
    console.log('\n=== SIMPLER SCENARIO ===')

    // Initial balances
    const initialCash = await getBalance(prisma, testEnv.cashAccount.id)
    const initialBank = await getBalance(prisma, testEnv.bankAccount.id)

    console.log(`Initial - Cash: ${initialCash}, Bank: ${initialBank}`)

    // Create a simple payment: $100 CASH, with $100 transferred to bank
    const result = await paymentService.createLeadPaymentReceived({
      leadId: testEnv.lead.id,
      agentId: testEnv.grantor.id,
      expectedAmount: 100,
      paidAmount: 100,
      cashPaidAmount: 0, // All transferred to bank
      bankPaidAmount: 92, // 100 - 8% commission
      paymentDate: new Date('2024-01-15'),
      payments: [
        {
          loanId: testEnv.loans[0].id,
          amount: 100,
          comission: 8,
          paymentMethod: 'CASH',
        },
      ],
    })

    trackLeadPaymentReceived(result.id)

    let cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    let bankBalance = await getBalance(prisma, testEnv.bankAccount.id)

    console.log(`After payment with transfer - Cash: ${cashBalance}, Bank: ${bankBalance}`)

    // Get the payment
    const loanPayments = await prisma.loanPayment.findMany({
      where: { leadPaymentReceived: result.id },
    })

    // Delete the payment
    await paymentService.updateLeadPaymentReceived(result.id, {
      cashPaidAmount: 0,
      bankPaidAmount: 0,
      payments: loanPayments.map(p => ({
        paymentId: p.id,
        loanId: p.loan,
        amount: 100,
        comission: 8,
        paymentMethod: 'CASH',
        isDeleted: true,
      })),
    })

    const finalCash = await getBalance(prisma, testEnv.cashAccount.id)
    const finalBank = await getBalance(prisma, testEnv.bankAccount.id)

    console.log(`After deletion - Cash: ${finalCash}, Bank: ${finalBank}`)
    console.log(`Cash diff: ${finalCash - initialCash}, Bank diff: ${finalBank - initialBank}`)

    await assertBalance(prisma, testEnv.cashAccount.id, initialCash, 'Cash should return to initial')
    await assertBalance(prisma, testEnv.bankAccount.id, initialBank, 'Bank should return to initial')
  })
})
