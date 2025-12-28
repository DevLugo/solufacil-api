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
 * ISOLATED BUG TESTS
 *
 * The complete flow test shows a 76 peso discrepancy.
 * 76 = 2 × 38 (commission on first payment for 2 renewals)
 *
 * These tests isolate each operation to find the exact source.
 */
describe('Isolate Bug - Find Source of 76 Peso Discrepancy', () => {
  let paymentService: PaymentService
  let loanService: LoanService
  let testEnv: {
    route: Awaited<ReturnType<typeof createTestRoute>>
    cashAccount: Awaited<ReturnType<typeof createTestAccount>>
    bankAccount: Awaited<ReturnType<typeof createTestAccount>>
    lead: Awaited<ReturnType<typeof createTestEmployee>>
    grantor: Awaited<ReturnType<typeof createTestEmployee>>
    loantype: Awaited<ReturnType<typeof createTestLoantype>>
    borrower: Awaited<ReturnType<typeof createTestBorrower>>
    loan: Awaited<ReturnType<typeof createTestLoan>>
  }

  const INITIAL_CASH = 50000
  const INITIAL_BANK = 100000

  beforeEach(async () => {
    paymentService = new PaymentService(prisma)
    loanService = new LoanService(prisma)

    const route = await createTestRoute(prisma)

    const cashAccount = await createTestAccount(prisma, route.id, {
      type: 'EMPLOYEE_CASH_FUND',
      name: 'Caja',
      balance: INITIAL_CASH,
    })

    const bankAccount = await createTestAccount(prisma, route.id, {
      type: 'BANK',
      name: 'Banco',
      balance: INITIAL_BANK,
    })

    const lead = await createTestEmployee(prisma, route.id, { type: 'LEAD' })
    const grantor = await createTestEmployee(prisma, route.id, { type: 'ROUTE_LEAD' })

    const loantype = await createTestLoantype(prisma, {
      weekDuration: 10,
      rate: 0.20,
      loanPaymentComission: 8,
      loanGrantedComission: 50,
    })

    const borrower = await createTestBorrower(prisma)

    const loan = await createTestLoan(prisma, borrower.id, loantype.id, lead.id, {
      amountGived: 1000,
      profitAmount: 200,
      totalDebtAcquired: 1200,
      expectedWeeklyPayment: 120,
      pendingAmountStored: 1200,
      status: 'ACTIVE',
    })

    testEnv = { route, cashAccount, bankAccount, lead, grantor, loantype, borrower, loan }
  })

  // ========================================
  // TEST 1: Simple loan create → cancel
  // ========================================
  it('TEST 1: Create loan WITHOUT first payment → Cancel → Balance restored', async () => {
    console.log('\n=== TEST 1: Loan without first payment ===')

    const initialCash = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`Initial cash: ${initialCash}`)

    // Create loan: 4000 + 50 commission = 4050 deducted
    const createdLoans = await loanService.createLoansInBatch({
      sourceAccountId: testEnv.cashAccount.id,
      signDate: new Date(),
      leadId: testEnv.lead.id,
      grantorId: testEnv.grantor.id,
      loans: [{
        tempId: 'test-1',
        requestedAmount: 4000,
        amountGived: 4000,
        loantypeId: testEnv.loantype.id,
        comissionAmount: 50,
        borrowerId: testEnv.borrower.id,
      }],
    })

    testData.loanIds.push(createdLoans[0].id)

    const afterCreate = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`After create: ${afterCreate} (expected: ${initialCash - 4050})`)
    expect(afterCreate).toBe(initialCash - 4050)

    // Cancel with restore
    await loanService.cancelLoanWithAccountRestore(createdLoans[0].id, testEnv.cashAccount.id)

    const afterCancel = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`After cancel: ${afterCancel} (expected: ${initialCash})`)

    await assertBalance(prisma, testEnv.cashAccount.id, initialCash, 'Should restore to initial')
  })

  // ========================================
  // TEST 2: Loan with first payment → cancel
  // ========================================
  it('TEST 2: Create loan WITH first payment → Cancel → Balance restored', async () => {
    console.log('\n=== TEST 2: Loan with first payment ===')

    const initialCash = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`Initial cash: ${initialCash}`)

    // Create loan with first payment
    // Loan: 4000 + 50 grant commission = 4050 out
    // First payment: 480 in - 38 commission = 442 net in
    // Net effect: -4050 + 442 = -3608
    const createdLoans = await loanService.createLoansInBatch({
      sourceAccountId: testEnv.cashAccount.id,
      signDate: new Date(),
      leadId: testEnv.lead.id,
      grantorId: testEnv.grantor.id,
      loans: [{
        tempId: 'test-2',
        requestedAmount: 4000,
        amountGived: 4000,
        loantypeId: testEnv.loantype.id,
        comissionAmount: 50,
        borrowerId: testEnv.borrower.id,
        firstPayment: {
          amount: 480,
          comission: 38, // 8% of 480
          paymentMethod: 'CASH',
        },
      }],
    })

    testData.loanIds.push(createdLoans[0].id)

    const afterCreate = await getBalance(prisma, testEnv.cashAccount.id)
    const expectedAfterCreate = initialCash - 4050 + 442 // -4050 loan, +442 net payment
    console.log(`After create: ${afterCreate} (expected: ${expectedAfterCreate})`)
    expect(afterCreate).toBe(expectedAfterCreate)

    // Cancel with restore
    await loanService.cancelLoanWithAccountRestore(createdLoans[0].id, testEnv.cashAccount.id)

    const afterCancel = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`After cancel: ${afterCancel} (expected: ${initialCash})`)
    console.log(`DIFFERENCE: ${afterCancel - initialCash}`)

    await assertBalance(prisma, testEnv.cashAccount.id, initialCash,
      'Should restore to initial after canceling loan with first payment')
  })

  // ========================================
  // TEST 3: Two loans with first payment → cancel both
  // ========================================
  it('TEST 3: Create 2 loans WITH first payment → Cancel both → Balance restored', async () => {
    console.log('\n=== TEST 3: Two loans with first payment ===')

    const borrower2 = await createTestBorrower(prisma, { name: 'Borrower 2' })

    const initialCash = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`Initial cash: ${initialCash}`)

    // Create first loan with first payment
    const loan1 = await loanService.createLoansInBatch({
      sourceAccountId: testEnv.cashAccount.id,
      signDate: new Date(),
      leadId: testEnv.lead.id,
      grantorId: testEnv.grantor.id,
      loans: [{
        tempId: 'test-3a',
        requestedAmount: 4000,
        amountGived: 4000,
        loantypeId: testEnv.loantype.id,
        comissionAmount: 50,
        borrowerId: testEnv.borrower.id,
        firstPayment: {
          amount: 480,
          comission: 38,
          paymentMethod: 'CASH',
        },
      }],
    })
    testData.loanIds.push(loan1[0].id)

    const afterLoan1 = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`After loan 1: ${afterLoan1}`)

    // Create second loan with first payment
    const loan2 = await loanService.createLoansInBatch({
      sourceAccountId: testEnv.cashAccount.id,
      signDate: new Date(),
      leadId: testEnv.lead.id,
      grantorId: testEnv.grantor.id,
      loans: [{
        tempId: 'test-3b',
        requestedAmount: 4000,
        amountGived: 4000,
        loantypeId: testEnv.loantype.id,
        comissionAmount: 50,
        borrowerId: borrower2.id,
        firstPayment: {
          amount: 480,
          comission: 38,
          paymentMethod: 'CASH',
        },
      }],
    })
    testData.loanIds.push(loan2[0].id)

    const afterLoan2 = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`After loan 2: ${afterLoan2}`)

    // Cancel both
    await loanService.cancelLoanWithAccountRestore(loan1[0].id, testEnv.cashAccount.id)
    const afterCancel1 = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`After cancel loan 1: ${afterCancel1}`)

    await loanService.cancelLoanWithAccountRestore(loan2[0].id, testEnv.cashAccount.id)
    const afterCancel2 = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`After cancel loan 2: ${afterCancel2}`)

    console.log(`DIFFERENCE: ${afterCancel2 - initialCash}`)

    await assertBalance(prisma, testEnv.cashAccount.id, initialCash,
      'Should restore to initial after canceling both loans')
  })

  // ========================================
  // TEST 4: Renewal scenario (previousLoanId set)
  // ========================================
  it('TEST 4: Renew existing loan WITH first payment → Cancel → Balance restored', async () => {
    console.log('\n=== TEST 4: Renewal with first payment ===')

    const initialCash = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`Initial cash: ${initialCash}`)

    // First, finish the existing loan (required for renewal)
    await prisma.loan.update({
      where: { id: testEnv.loan.id },
      data: { status: 'FINISHED', finishedDate: new Date() },
    })

    // Renew with first payment
    const renewedLoan = await loanService.createLoansInBatch({
      sourceAccountId: testEnv.cashAccount.id,
      signDate: new Date(),
      leadId: testEnv.lead.id,
      grantorId: testEnv.grantor.id,
      loans: [{
        tempId: 'renew-test',
        requestedAmount: 4000,
        amountGived: 4000,
        loantypeId: testEnv.loantype.id,
        comissionAmount: 50,
        borrowerId: testEnv.borrower.id,
        previousLoanId: testEnv.loan.id, // This makes it a renewal
        firstPayment: {
          amount: 480,
          comission: 38,
          paymentMethod: 'CASH',
        },
      }],
    })

    testData.loanIds.push(renewedLoan[0].id)

    const afterRenewal = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`After renewal: ${afterRenewal}`)

    // Cancel the renewed loan
    await loanService.cancelLoanWithAccountRestore(renewedLoan[0].id, testEnv.cashAccount.id)

    const afterCancel = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`After cancel: ${afterCancel}`)
    console.log(`DIFFERENCE: ${afterCancel - initialCash}`)

    await assertBalance(prisma, testEnv.cashAccount.id, initialCash,
      'Should restore to initial after canceling renewed loan')
  })

  // ========================================
  // TEST 5: Check cancelLoanWithAccountRestore logic
  // ========================================
  it('TEST 5: Examine what cancelLoanWithAccountRestore restores', async () => {
    console.log('\n=== TEST 5: Detailed cancel examination ===')

    const initialCash = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`Initial cash: ${initialCash}`)

    // Create loan with first payment
    const createdLoans = await loanService.createLoansInBatch({
      sourceAccountId: testEnv.cashAccount.id,
      signDate: new Date(),
      leadId: testEnv.lead.id,
      grantorId: testEnv.grantor.id,
      loans: [{
        tempId: 'test-5',
        requestedAmount: 4000,
        amountGived: 4000,
        loantypeId: testEnv.loantype.id,
        comissionAmount: 50,
        borrowerId: testEnv.borrower.id,
        firstPayment: {
          amount: 480,
          comission: 38,
          paymentMethod: 'CASH',
        },
      }],
    })

    const loanId = createdLoans[0].id
    testData.loanIds.push(loanId)

    // Check what transactions exist for this loan
    const transactions = await prisma.transaction.findMany({
      where: { loan: loanId },
    })

    console.log('\nTransactions for this loan:')
    for (const t of transactions) {
      console.log(`  - ${t.type}: ${t.amount} (source: ${t.sourceAccount})`)
    }

    // Check loan payments
    const loanPayments = await prisma.loanPayment.findMany({
      where: { loan: loanId },
    })

    console.log('\nLoan payments:')
    for (const p of loanPayments) {
      console.log(`  - Amount: ${p.amount}, Commission: ${p.comission}, Method: ${p.paymentMethod}`)
    }

    const afterCreate = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`\nCash after create: ${afterCreate}`)

    // Now cancel
    console.log('\n--- Canceling loan ---')
    await loanService.cancelLoanWithAccountRestore(loanId, testEnv.cashAccount.id)

    // Check transactions again
    const transactionsAfter = await prisma.transaction.findMany({
      where: { loan: loanId },
    })
    console.log(`\nTransactions after cancel: ${transactionsAfter.length}`)

    const afterCancel = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`Cash after cancel: ${afterCancel}`)
    console.log(`\nExpected restoration: +4050 (loan) -442 (first payment net) = +3608`)
    console.log(`Actual change: ${afterCancel - afterCreate}`)
    console.log(`FINAL DIFFERENCE from initial: ${afterCancel - initialCash}`)

    await assertBalance(prisma, testEnv.cashAccount.id, initialCash, 'Should restore to initial')
  })
})
