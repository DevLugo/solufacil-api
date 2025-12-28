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
 * ISOLATED BUG TESTS - Part 2
 *
 * Testing the interaction between:
 * 1. Creating payments via PaymentService
 * 2. Creating renewals with first payment via LoanService
 * 3. Reverting the payments
 * 4. Canceling the renewals
 */
describe('Isolate Bug Part 2 - Payment + Renewal Interaction', () => {
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
      balance: INITIAL_CASH,
    })

    const bankAccount = await createTestAccount(prisma, route.id, {
      type: 'BANK',
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

    // Create an active loan that we can make payments on
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

  it('TEST A: Payment → Renewal with first payment → Cancel renewal → Balance check', async () => {
    console.log('\n=== TEST A: Payment → Renewal → Cancel ===')

    const initialCash = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`1. Initial cash: ${initialCash}`)

    // STEP 1: Create a payment on the existing loan
    const paymentResult = await paymentService.createLeadPaymentReceived({
      leadId: testEnv.lead.id,
      agentId: testEnv.grantor.id,
      expectedAmount: 120,
      paidAmount: 120,
      cashPaidAmount: 112, // 120 - 8 commission
      bankPaidAmount: 0,
      paymentDate: new Date('2024-01-15'),
      payments: [{
        loanId: testEnv.loan.id,
        amount: 120,
        comission: 10,
        paymentMethod: 'CASH',
      }],
    })
    trackLeadPaymentReceived(paymentResult.id)

    const afterPayment = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`2. After payment: ${afterPayment} (expected: ${initialCash + 110})`)

    // STEP 2: Finish the loan and create renewal with first payment
    await prisma.loan.update({
      where: { id: testEnv.loan.id },
      data: { status: 'FINISHED', finishedDate: new Date() },
    })

    const renewedLoans = await loanService.createLoansInBatch({
      sourceAccountId: testEnv.cashAccount.id,
      signDate: new Date('2024-01-15'),
      leadId: testEnv.lead.id,
      grantorId: testEnv.grantor.id,
      loans: [{
        tempId: 'renew-a',
        requestedAmount: 4000,
        amountGived: 4000,
        loantypeId: testEnv.loantype.id,
        comissionAmount: 50,
        borrowerId: testEnv.borrower.id,
        previousLoanId: testEnv.loan.id,
        firstPayment: {
          amount: 480,
          comission: 38,
          paymentMethod: 'CASH',
        },
      }],
    })
    testData.loanIds.push(renewedLoans[0].id)

    const afterRenewal = await getBalance(prisma, testEnv.cashAccount.id)
    // Expected: afterPayment - 4050 (loan+commission) + 442 (first payment net)
    console.log(`3. After renewal: ${afterRenewal}`)

    // STEP 3: Cancel the renewed loan
    await loanService.cancelLoanWithAccountRestore(renewedLoans[0].id, testEnv.cashAccount.id)

    const afterCancel = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`4. After cancel renewal: ${afterCancel}`)

    // Should be back to afterPayment
    console.log(`\nExpected after cancel: ${afterPayment}`)
    console.log(`Actual after cancel: ${afterCancel}`)
    console.log(`DIFFERENCE: ${afterCancel - afterPayment}`)

    expect(afterCancel).toBe(afterPayment)
  })

  it('TEST B: Payment → Renewal → Revert payment → Cancel renewal', async () => {
    console.log('\n=== TEST B: Full flow with payment revert ===')

    const initialCash = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`1. Initial cash: ${initialCash}`)

    // STEP 1: Create payment
    const paymentResult = await paymentService.createLeadPaymentReceived({
      leadId: testEnv.lead.id,
      agentId: testEnv.grantor.id,
      expectedAmount: 120,
      paidAmount: 120,
      cashPaidAmount: 110,
      bankPaidAmount: 0,
      paymentDate: new Date('2024-01-15'),
      payments: [{
        loanId: testEnv.loan.id,
        amount: 120,
        comission: 10,
        paymentMethod: 'CASH',
      }],
    })
    trackLeadPaymentReceived(paymentResult.id)

    const afterPayment = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`2. After payment: ${afterPayment}`)

    // STEP 2: Renewal with first payment
    await prisma.loan.update({
      where: { id: testEnv.loan.id },
      data: { status: 'FINISHED', finishedDate: new Date() },
    })

    const renewedLoans = await loanService.createLoansInBatch({
      sourceAccountId: testEnv.cashAccount.id,
      signDate: new Date('2024-01-15'),
      leadId: testEnv.lead.id,
      grantorId: testEnv.grantor.id,
      loans: [{
        tempId: 'renew-b',
        requestedAmount: 4000,
        amountGived: 4000,
        loantypeId: testEnv.loantype.id,
        comissionAmount: 50,
        borrowerId: testEnv.borrower.id,
        previousLoanId: testEnv.loan.id,
        firstPayment: {
          amount: 480,
          comission: 38,
          paymentMethod: 'CASH',
        },
      }],
    })
    testData.loanIds.push(renewedLoans[0].id)

    const afterRenewal = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`3. After renewal: ${afterRenewal}`)

    // STEP 3: Revert the original payment (mark as deleted)
    const loanPayments = await prisma.loanPayment.findMany({
      where: { leadPaymentReceived: paymentResult.id },
    })

    console.log(`\n   Payments in original LeadPaymentReceived: ${loanPayments.length}`)
    for (const p of loanPayments) {
      console.log(`   - Loan: ${p.loan}, Amount: ${p.amount}`)
    }

    await paymentService.updateLeadPaymentReceived(paymentResult.id, {
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

    const afterRevertPayment = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`4. After revert payment: ${afterRevertPayment}`)

    // STEP 4: Cancel the renewed loan
    await loanService.cancelLoanWithAccountRestore(renewedLoans[0].id, testEnv.cashAccount.id)

    const finalCash = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`5. After cancel renewal: ${finalCash}`)

    console.log(`\n========================================`)
    console.log(`Initial: ${initialCash}`)
    console.log(`Final:   ${finalCash}`)
    console.log(`DIFFERENCE: ${finalCash - initialCash}`)
    console.log(`========================================`)

    await assertBalance(prisma, testEnv.cashAccount.id, initialCash,
      'Should return to initial after all reversals')
  })

  it('TEST C: Just renewal with first payment - check LeadPaymentReceived', async () => {
    console.log('\n=== TEST C: Check LeadPaymentReceived structure ===')

    const initialCash = await getBalance(prisma, testEnv.cashAccount.id)

    // Finish loan and create renewal
    await prisma.loan.update({
      where: { id: testEnv.loan.id },
      data: { status: 'FINISHED', finishedDate: new Date() },
    })

    const renewedLoans = await loanService.createLoansInBatch({
      sourceAccountId: testEnv.cashAccount.id,
      signDate: new Date('2024-01-15'),
      leadId: testEnv.lead.id,
      grantorId: testEnv.grantor.id,
      loans: [{
        tempId: 'renew-c',
        requestedAmount: 4000,
        amountGived: 4000,
        loantypeId: testEnv.loantype.id,
        comissionAmount: 50,
        borrowerId: testEnv.borrower.id,
        previousLoanId: testEnv.loan.id,
        firstPayment: {
          amount: 480,
          comission: 38,
          paymentMethod: 'CASH',
        },
      }],
    })
    testData.loanIds.push(renewedLoans[0].id)

    // Check what LeadPaymentReceived was created
    const lpr = await prisma.leadPaymentReceived.findFirst({
      where: {
        payments: {
          some: { loan: renewedLoans[0].id }
        }
      },
      include: {
        payments: true,
      }
    })

    console.log('\nLeadPaymentReceived created for first payment:')
    console.log(`  ID: ${lpr?.id}`)
    console.log(`  paidAmount: ${lpr?.paidAmount}`)
    console.log(`  cashPaidAmount: ${lpr?.cashPaidAmount}`)
    console.log(`  bankPaidAmount: ${lpr?.bankPaidAmount}`)
    console.log(`  Payments count: ${lpr?.payments.length}`)

    if (lpr) {
      trackLeadPaymentReceived(lpr.id)
    }

    // Now cancel
    console.log('\n--- Canceling loan ---')
    await loanService.cancelLoanWithAccountRestore(renewedLoans[0].id, testEnv.cashAccount.id)

    // Check if LeadPaymentReceived still exists
    const lprAfter = await prisma.leadPaymentReceived.findUnique({
      where: { id: lpr?.id },
      include: { payments: true }
    })

    console.log('\nLeadPaymentReceived after cancel:')
    console.log(`  Exists: ${!!lprAfter}`)
    if (lprAfter) {
      console.log(`  paidAmount: ${lprAfter.paidAmount}`)
      console.log(`  Payments count: ${lprAfter.payments.length}`)
    }

    const finalCash = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`\nInitial cash: ${initialCash}`)
    console.log(`Final cash: ${finalCash}`)
    console.log(`DIFFERENCE: ${finalCash - initialCash}`)

    await assertBalance(prisma, testEnv.cashAccount.id, initialCash, 'Should return to initial')
  })
})
