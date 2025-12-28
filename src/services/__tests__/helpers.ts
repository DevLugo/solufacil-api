import type { ExtendedPrismaClient } from '@solufacil/database'

type PrismaClient = ExtendedPrismaClient
import { Decimal } from 'decimal.js'
import { expect } from 'vitest'
import { testData } from './setup'

/**
 * Create a test route with accounts
 */
export async function createTestRoute(prisma: PrismaClient, name = 'Test Route') {
  const route = await prisma.route.create({
    data: { name },
  })
  testData.routeIds.push(route.id)
  return route
}

/**
 * Create a test account attached to a route
 */
export async function createTestAccount(
  prisma: PrismaClient,
  routeId: string,
  options: {
    type?: 'EMPLOYEE_CASH_FUND' | 'BANK' | 'OFFICE_CASH_FUND'
    balance?: number
    name?: string
  } = {}
) {
  const { type = 'EMPLOYEE_CASH_FUND', balance = 0, name = 'Test Account' } = options

  const account = await prisma.account.create({
    data: {
      name,
      type,
      amount: new Decimal(balance),
      routes: { connect: { id: routeId } },
    },
  })
  testData.accountIds.push(account.id)
  return account
}

/**
 * Create a test employee (lead/agent)
 */
export async function createTestEmployee(
  prisma: PrismaClient,
  routeId: string,
  options: {
    type?: 'LEAD' | 'ROUTE_LEAD'
    name?: string
  } = {}
) {
  const { type = 'LEAD', name = 'Test Employee' } = options

  // Create PersonalData first
  const personalData = await prisma.personalData.create({
    data: {
      fullName: name,
      clientCode: `EMP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    },
  })
  testData.personalDataIds.push(personalData.id)

  const employee = await prisma.employee.create({
    data: {
      type,
      personalData: personalData.id,
      routes: { connect: { id: routeId } },
    },
  })
  testData.employeeIds.push(employee.id)
  return employee
}

/**
 * Create a test borrower
 */
export async function createTestBorrower(
  prisma: PrismaClient,
  options: { name?: string } = {}
) {
  const { name = 'Test Borrower' } = options

  // Create PersonalData first
  const personalData = await prisma.personalData.create({
    data: {
      fullName: name,
      clientCode: `BRW-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    },
  })
  testData.personalDataIds.push(personalData.id)

  const borrower = await prisma.borrower.create({
    data: {
      personalData: personalData.id,
    },
  })
  testData.borrowerIds.push(borrower.id)
  return borrower
}

/**
 * Create a test loantype
 */
export async function createTestLoantype(
  prisma: PrismaClient,
  options: {
    name?: string
    weekDuration?: number
    rate?: number
    loanPaymentComission?: number
    loanGrantedComission?: number
  } = {}
) {
  const {
    name = 'Test Loantype',
    weekDuration = 10,
    rate = 0.2,
    loanPaymentComission = 8,
    loanGrantedComission = 50,
  } = options

  const loantype = await prisma.loantype.create({
    data: {
      name,
      weekDuration,
      rate: new Decimal(rate),
      loanPaymentComission: new Decimal(loanPaymentComission),
      loanGrantedComission: new Decimal(loanGrantedComission),
    },
  })
  testData.loantypeIds.push(loantype.id)
  return loantype
}

/**
 * Create a test loan
 */
export async function createTestLoan(
  prisma: PrismaClient,
  borrowerId: string,
  loantypeId: string,
  leadId: string,
  options: {
    amountGived?: number
    profitAmount?: number
    totalDebtAcquired?: number
    expectedWeeklyPayment?: number
    pendingAmountStored?: number
    status?: 'ACTIVE' | 'FINISHED' | 'RENOVATED' | 'CANCELLED'
  } = {}
) {
  const {
    amountGived = 1000,
    profitAmount = 200,
    totalDebtAcquired = amountGived + profitAmount,
    expectedWeeklyPayment = totalDebtAcquired / 10,
    pendingAmountStored = totalDebtAcquired,
    status = 'ACTIVE',
  } = options

  const loan = await prisma.loan.create({
    data: {
      requestedAmount: new Decimal(amountGived),
      amountGived: new Decimal(amountGived),
      profitAmount: new Decimal(profitAmount),
      totalDebtAcquired: new Decimal(totalDebtAcquired),
      expectedWeeklyPayment: new Decimal(expectedWeeklyPayment),
      totalPaid: new Decimal(0),
      pendingAmountStored: new Decimal(pendingAmountStored),
      comissionAmount: new Decimal(0),
      status,
      borrower: borrowerId,
      loantype: loantypeId,
      lead: leadId,
    },
  })
  testData.loanIds.push(loan.id)
  return loan
}

/**
 * Assert that an account has the expected balance
 */
export async function assertBalance(
  prisma: PrismaClient,
  accountId: string,
  expectedBalance: number,
  message?: string
) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
  })

  if (!account) {
    throw new Error(`Account ${accountId} not found`)
  }

  const actual = new Decimal(account.amount.toString()).toNumber()
  const expected = expectedBalance

  expect(actual, message || `Expected balance to be ${expected} but got ${actual}`).toBeCloseTo(expected, 2)
}

/**
 * Get current account balance
 */
export async function getBalance(prisma: PrismaClient, accountId: string): Promise<number> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
  })

  if (!account) {
    throw new Error(`Account ${accountId} not found`)
  }

  return new Decimal(account.amount.toString()).toNumber()
}

/**
 * Helper to set up a complete test environment
 * Returns all the entities needed for payment tests
 */
export async function setupTestEnvironment(prisma: PrismaClient) {
  // Create route
  const route = await createTestRoute(prisma)

  // Create accounts
  const cashAccount = await createTestAccount(prisma, route.id, {
    type: 'EMPLOYEE_CASH_FUND',
    name: 'Test Cash Account',
    balance: 0,
  })

  const bankAccount = await createTestAccount(prisma, route.id, {
    type: 'BANK',
    name: 'Test Bank Account',
    balance: 0,
  })

  // Create lead and agent (both are employees)
  const lead = await createTestEmployee(prisma, route.id, {
    type: 'LEAD',
    name: 'Test Lead',
  })

  const agent = await createTestEmployee(prisma, route.id, {
    type: 'ROUTE_LEAD',
    name: 'Test Agent',
  })

  // Create borrower
  const borrower = await createTestBorrower(prisma)

  // Create loantype
  const loantype = await createTestLoantype(prisma, {
    loanPaymentComission: 8, // 8% commission on payments
  })

  // Create loan with debt
  const loan = await createTestLoan(prisma, borrower.id, loantype.id, lead.id, {
    amountGived: 1000,
    profitAmount: 200,
    totalDebtAcquired: 1200,
    pendingAmountStored: 1200,
  })

  return {
    route,
    cashAccount,
    bankAccount,
    lead,
    agent,
    borrower,
    loantype,
    loan,
  }
}

/**
 * Track a created LeadPaymentReceived for cleanup
 */
export function trackLeadPaymentReceived(id: string) {
  testData.leadPaymentReceivedIds.push(id)
}

/**
 * Track a created LoanPayment for cleanup
 */
export function trackLoanPayment(id: string) {
  testData.loanPaymentIds.push(id)
}

