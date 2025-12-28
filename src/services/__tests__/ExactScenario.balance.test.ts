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
 * EXACT SCENARIO TEST - User reported bug where balance ends up MORE than initial
 *
 * Steps:
 * 1. Start with 50k cash, 100k bank
 * 2. Different date (no other movements)
 * 3. Mark 2 loans as missing, 1 as bank, rest as cash
 * 4. Save with 100 as transfer, rest cash
 * 5. Renew loan for 4k with first payment
 * 6. Renew another loan for 4k with first payment
 * 7. Mark all as no payment, set transfer to 0
 * 8. Delete the 2 renewed loans
 * 9. Balance should be identical to initial but ENDS UP MORE
 */
describe('Exact Scenario - Balance ends up MORE than initial', () => {
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

    // Create 5 borrowers with active loans ($1000 each)
    const borrowers: Awaited<ReturnType<typeof createTestBorrower>>[] = []
    const loans: Awaited<ReturnType<typeof createTestLoan>>[] = []

    for (let i = 0; i < 5; i++) {
      const borrower = await createTestBorrower(prisma, { name: `Borrower ${i + 1}` })
      borrowers.push(borrower)

      const loan = await createTestLoan(prisma, borrower.id, loantype.id, lead.id, {
        amountGived: 1000,
        profitAmount: 200,
        totalDebtAcquired: 1200,
        expectedWeeklyPayment: 120,
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

  it('Exact user scenario: payments + renewals + revert + delete = MORE balance (BUG)', async () => {
    console.log('\n' + '='.repeat(60))
    console.log('EXACT USER SCENARIO TEST')
    console.log('='.repeat(60))

    // ========================================
    // STEP 1: Verify initial balances
    // ========================================
    console.log('\n--- STEP 1: Initial balances ---')
    const initialCash = await getBalance(prisma, testEnv.cashAccount.id)
    const initialBank = await getBalance(prisma, testEnv.bankAccount.id)
    console.log(`Cash: ${initialCash}, Bank: ${initialBank}`)

    expect(initialCash).toBe(INITIAL_CASH_BALANCE)
    expect(initialBank).toBe(INITIAL_BANK_BALANCE)

    // ========================================
    // STEP 3 & 4: Create payments
    // - 2 loans: NO PAYMENT (falta) - loans[3] and loans[4]
    // - 1 loan: MONEY_TRANSFER - loans[2]
    // - 2 loans: CASH - loans[0] and loans[1]
    // - Transfer: 100 from cash to bank
    // ========================================
    console.log('\n--- STEP 3 & 4: Create payments (2 missing, 1 bank, 2 cash, 100 transfer) ---')

    const paymentAmount = 120
    const commission = 10 // ~8%

    // Calculate amounts:
    // - 3 payments of $120 = $360 total
    // - 1 bank ($120) + 2 cash ($240)
    // - Commission deducted: 3 * $10 = $30
    // - Cash after commission: $240 - $20 = $220 (for 2 cash payments)
    // - Bank payment: $120 - $10 = $110
    // - Transfer: $100 from cash to bank
    // - Final cash received: $220 - $100 = $120
    // - Final bank received: $110 + $100 = $210

    const cashPaymentsNet = (paymentAmount - commission) * 2 // $110 * 2 = $220
    const bankPaymentNet = paymentAmount - commission // $110
    const transferAmount = 100

    const leadPaymentResult = await paymentService.createLeadPaymentReceived({
      leadId: testEnv.lead.id,
      agentId: testEnv.grantor.id,
      expectedAmount: paymentAmount * 3,
      paidAmount: paymentAmount * 3,
      cashPaidAmount: cashPaymentsNet - transferAmount, // $220 - $100 = $120
      bankPaidAmount: bankPaymentNet + transferAmount, // $110 + $100 = $210
      paymentDate: new Date('2024-01-15'),
      payments: [
        // 2 CASH payments
        {
          loanId: testEnv.loans[0].id,
          amount: paymentAmount,
          comission: commission,
          paymentMethod: 'CASH',
        },
        {
          loanId: testEnv.loans[1].id,
          amount: paymentAmount,
          comission: commission,
          paymentMethod: 'CASH',
        },
        // 1 BANK payment
        {
          loanId: testEnv.loans[2].id,
          amount: paymentAmount,
          comission: commission,
          paymentMethod: 'MONEY_TRANSFER',
        },
      ],
    })

    trackLeadPaymentReceived(leadPaymentResult.id)

    let cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    let bankBalance = await getBalance(prisma, testEnv.bankAccount.id)

    console.log(`After payments - Cash: ${cashBalance}, Bank: ${bankBalance}`)
    console.log(`  Cash change: ${cashBalance - initialCash}`)
    console.log(`  Bank change: ${bankBalance - initialBank}`)

    // ========================================
    // STEP 5: Renew first loan for $4000 with first payment
    // ========================================
    console.log('\n--- STEP 5: Renew loan 1 for $4000 with first payment ---')

    // First finish the loan we're renewing
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
          comissionAmount: 50,
          borrowerId: testEnv.borrowers[0].id,
          previousLoanId: testEnv.loans[0].id,
          firstPayment: {
            amount: 480, // $4800 / 10 weeks
            comission: 38, // 8%
            paymentMethod: 'CASH',
          },
        },
      ],
    })

    testData.loanIds.push(renewedLoans1[0].id)

    cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    bankBalance = await getBalance(prisma, testEnv.bankAccount.id)

    console.log(`After renewal 1 - Cash: ${cashBalance}, Bank: ${bankBalance}`)
    console.log(`  Cash change from initial: ${cashBalance - initialCash}`)

    // ========================================
    // STEP 6: Renew second loan for $4000 with first payment
    // ========================================
    console.log('\n--- STEP 6: Renew loan 2 for $4000 with first payment ---')

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

    console.log(`After renewal 2 - Cash: ${cashBalance}, Bank: ${bankBalance}`)
    console.log(`  Cash change from initial: ${cashBalance - initialCash}`)

    // ========================================
    // STEP 7: Mark ALL payments as NO PAYMENT with transfer = 0
    // (The key difference: original had 100 transfer, now 0)
    // ========================================
    console.log('\n--- STEP 7: Revert all payments (transfer = 0) ---')

    // Get the original loan payments
    const loanPayments = await prisma.loanPayment.findMany({
      where: { leadPaymentReceived: leadPaymentResult.id },
    })

    console.log(`  Payments to revert: ${loanPayments.length}`)
    for (const p of loanPayments) {
      console.log(`    - Loan: ${p.loan}, Amount: ${p.amount}, Method: ${p.paymentMethod}`)
    }

    // Update to delete all payments with transfer = 0
    await paymentService.updateLeadPaymentReceived(leadPaymentResult.id, {
      cashPaidAmount: 0, // All gone
      bankPaidAmount: 0, // All gone, NO TRANSFER
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

    console.log(`After revert (transfer=0) - Cash: ${cashBalance}, Bank: ${bankBalance}`)
    console.log(`  Cash change from initial: ${cashBalance - initialCash}`)
    console.log(`  Bank change from initial: ${bankBalance - initialBank}`)

    // ========================================
    // STEP 8: Delete the 2 renewed loans
    // ========================================
    console.log('\n--- STEP 8: Delete renewed loans ---')

    await loanService.cancelLoanWithAccountRestore(renewedLoans1[0].id, testEnv.cashAccount.id)

    cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    console.log(`After cancel loan 1 - Cash: ${cashBalance}`)

    await loanService.cancelLoanWithAccountRestore(renewedLoans2[0].id, testEnv.cashAccount.id)

    cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    bankBalance = await getBalance(prisma, testEnv.bankAccount.id)

    console.log(`After cancel loan 2 - Cash: ${cashBalance}, Bank: ${bankBalance}`)

    // ========================================
    // STEP 9: Verify balances
    // ========================================
    console.log('\n' + '='.repeat(60))
    console.log('FINAL BALANCE COMPARISON')
    console.log('='.repeat(60))

    const finalCash = await getBalance(prisma, testEnv.cashAccount.id)
    const finalBank = await getBalance(prisma, testEnv.bankAccount.id)

    const cashDiff = finalCash - initialCash
    const bankDiff = finalBank - initialBank

    console.log(`Initial Cash: ${initialCash}`)
    console.log(`Final Cash:   ${finalCash}`)
    console.log(`Cash Diff:    ${cashDiff} ${cashDiff > 0 ? '(MORE - BUG!)' : cashDiff < 0 ? '(LESS - BUG!)' : '(OK)'}`)
    console.log('')
    console.log(`Initial Bank: ${initialBank}`)
    console.log(`Final Bank:   ${finalBank}`)
    console.log(`Bank Diff:    ${bankDiff} ${bankDiff > 0 ? '(MORE - BUG!)' : bankDiff < 0 ? '(LESS - BUG!)' : '(OK)'}`)
    console.log('='.repeat(60))

    // This should pass - balance should return to initial
    await assertBalance(
      prisma,
      testEnv.cashAccount.id,
      INITIAL_CASH_BALANCE,
      `Cash should return to initial ${INITIAL_CASH_BALANCE}`
    )

    await assertBalance(
      prisma,
      testEnv.bankAccount.id,
      INITIAL_BANK_BALANCE,
      `Bank should return to initial ${INITIAL_BANK_BALANCE}`
    )
  })

  it('Debug: Check AccountEntry for the full scenario', async () => {
    console.log('\n' + '='.repeat(60))
    console.log('DEBUG: AccountEntry trace for full scenario')
    console.log('='.repeat(60))

    const initialCash = INITIAL_CASH_BALANCE
    const initialBank = INITIAL_BANK_BALANCE

    // Step 3-4: Create payments
    const paymentAmount = 120
    const commission = 10
    const transferAmount = 100

    const cashPaymentsNet = (paymentAmount - commission) * 2
    const bankPaymentNet = paymentAmount - commission

    const leadPaymentResult = await paymentService.createLeadPaymentReceived({
      leadId: testEnv.lead.id,
      agentId: testEnv.grantor.id,
      expectedAmount: paymentAmount * 3,
      paidAmount: paymentAmount * 3,
      cashPaidAmount: cashPaymentsNet - transferAmount,
      bankPaidAmount: bankPaymentNet + transferAmount,
      paymentDate: new Date('2024-01-15'),
      payments: [
        { loanId: testEnv.loans[0].id, amount: paymentAmount, comission: commission, paymentMethod: 'CASH' },
        { loanId: testEnv.loans[1].id, amount: paymentAmount, comission: commission, paymentMethod: 'CASH' },
        { loanId: testEnv.loans[2].id, amount: paymentAmount, comission: commission, paymentMethod: 'MONEY_TRANSFER' },
      ],
    })

    trackLeadPaymentReceived(leadPaymentResult.id)

    // Show AccountEntry after payment creation
    console.log('\n--- After payment creation ---')
    let entries = await prisma.accountEntry.findMany({
      where: {
        OR: [
          { accountId: testEnv.cashAccount.id },
          { accountId: testEnv.bankAccount.id },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })

    console.log(`Total entries: ${entries.length}`)
    for (const e of entries) {
      const account = e.accountId === testEnv.cashAccount.id ? 'CASH' : 'BANK'
      console.log(`  ${account} | ${e.entryType} | ${e.sourceType} | ${e.amount}`)
    }

    let cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    let bankBalance = await getBalance(prisma, testEnv.bankAccount.id)
    console.log(`Cash: ${cashBalance} (change: ${cashBalance - initialCash})`)
    console.log(`Bank: ${bankBalance} (change: ${bankBalance - initialBank})`)

    // Step 5-6: Renewals
    await prisma.loan.update({
      where: { id: testEnv.loans[0].id },
      data: { status: 'FINISHED', finishedDate: new Date() },
    })

    const renewedLoans1 = await loanService.createLoansInBatch({
      sourceAccountId: testEnv.cashAccount.id,
      signDate: new Date('2024-01-15'),
      leadId: testEnv.lead.id,
      grantorId: testEnv.grantor.id,
      loans: [{
        tempId: 'renew-1',
        requestedAmount: 4000,
        amountGived: 4000,
        loantypeId: testEnv.loantype.id,
        comissionAmount: 50,
        borrowerId: testEnv.borrowers[0].id,
        previousLoanId: testEnv.loans[0].id,
        firstPayment: { amount: 480, comission: 38, paymentMethod: 'CASH' },
      }],
    })
    testData.loanIds.push(renewedLoans1[0].id)

    await prisma.loan.update({
      where: { id: testEnv.loans[1].id },
      data: { status: 'FINISHED', finishedDate: new Date() },
    })

    const renewedLoans2 = await loanService.createLoansInBatch({
      sourceAccountId: testEnv.cashAccount.id,
      signDate: new Date('2024-01-15'),
      leadId: testEnv.lead.id,
      grantorId: testEnv.grantor.id,
      loans: [{
        tempId: 'renew-2',
        requestedAmount: 4000,
        amountGived: 4000,
        loantypeId: testEnv.loantype.id,
        comissionAmount: 50,
        borrowerId: testEnv.borrowers[1].id,
        previousLoanId: testEnv.loans[1].id,
        firstPayment: { amount: 480, comission: 38, paymentMethod: 'CASH' },
      }],
    })
    testData.loanIds.push(renewedLoans2[0].id)

    console.log('\n--- After renewals ---')
    entries = await prisma.accountEntry.findMany({
      where: {
        OR: [
          { accountId: testEnv.cashAccount.id },
          { accountId: testEnv.bankAccount.id },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })

    console.log(`Total entries: ${entries.length}`)
    for (const e of entries) {
      const account = e.accountId === testEnv.cashAccount.id ? 'CASH' : 'BANK'
      console.log(`  ${account} | ${e.entryType} | ${e.sourceType} | ${e.amount}`)
    }

    cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    bankBalance = await getBalance(prisma, testEnv.bankAccount.id)
    console.log(`Cash: ${cashBalance} (change: ${cashBalance - initialCash})`)
    console.log(`Bank: ${bankBalance} (change: ${bankBalance - initialBank})`)

    // Step 7: Revert payments
    const loanPayments = await prisma.loanPayment.findMany({
      where: { leadPaymentReceived: leadPaymentResult.id },
    })

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

    console.log('\n--- After revert payments ---')
    entries = await prisma.accountEntry.findMany({
      where: {
        OR: [
          { accountId: testEnv.cashAccount.id },
          { accountId: testEnv.bankAccount.id },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })

    console.log(`Total entries: ${entries.length}`)
    for (const e of entries) {
      const account = e.accountId === testEnv.cashAccount.id ? 'CASH' : 'BANK'
      console.log(`  ${account} | ${e.entryType} | ${e.sourceType} | ${e.amount}`)
    }

    cashBalance = await getBalance(prisma, testEnv.cashAccount.id)
    bankBalance = await getBalance(prisma, testEnv.bankAccount.id)
    console.log(`Cash: ${cashBalance} (change: ${cashBalance - initialCash})`)
    console.log(`Bank: ${bankBalance} (change: ${bankBalance - initialBank})`)

    // Step 8: Cancel loans
    await loanService.cancelLoanWithAccountRestore(renewedLoans1[0].id, testEnv.cashAccount.id)
    await loanService.cancelLoanWithAccountRestore(renewedLoans2[0].id, testEnv.cashAccount.id)

    console.log('\n--- After cancel loans ---')
    entries = await prisma.accountEntry.findMany({
      where: {
        OR: [
          { accountId: testEnv.cashAccount.id },
          { accountId: testEnv.bankAccount.id },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })

    console.log(`Total entries: ${entries.length}`)
    for (const e of entries) {
      const account = e.accountId === testEnv.cashAccount.id ? 'CASH' : 'BANK'
      console.log(`  ${account} | ${e.entryType} | ${e.sourceType} | ${e.amount}`)
    }

    const finalCash = await getBalance(prisma, testEnv.cashAccount.id)
    const finalBank = await getBalance(prisma, testEnv.bankAccount.id)

    console.log('\n' + '='.repeat(60))
    console.log(`FINAL: Cash: ${finalCash} (diff: ${finalCash - initialCash})`)
    console.log(`FINAL: Bank: ${finalBank} (diff: ${finalBank - initialBank})`)
    console.log('='.repeat(60))

    expect(finalCash).toBe(initialCash)
    expect(finalBank).toBe(initialBank)
  })
})
