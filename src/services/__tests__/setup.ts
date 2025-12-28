import { prisma } from '@solufacil/database'
import { beforeEach, afterEach } from 'vitest'

export { prisma }

// Test data tracking for cleanup
export const testData = {
  accountIds: [] as string[],
  routeIds: [] as string[],
  employeeIds: [] as string[],
  borrowerIds: [] as string[],
  loanIds: [] as string[],
  loantypeIds: [] as string[],
  leadPaymentReceivedIds: [] as string[],
  transactionIds: [] as string[],
  loanPaymentIds: [] as string[],
  personalDataIds: [] as string[],
  accountEntryIds: [] as string[],
}

beforeEach(async () => {
  // Reset tracking arrays
  testData.accountIds = []
  testData.routeIds = []
  testData.employeeIds = []
  testData.borrowerIds = []
  testData.loanIds = []
  testData.loantypeIds = []
  testData.leadPaymentReceivedIds = []
  testData.transactionIds = []
  testData.loanPaymentIds = []
  testData.personalDataIds = []
  testData.accountEntryIds = []
})

afterEach(async () => {
  // Clean up test data in correct order (respecting FK constraints)
  try {
    // Delete in reverse order of dependencies

    // AccountEntry must be deleted before Account (required FK)
    if (testData.accountEntryIds.length > 0) {
      await prisma.accountEntry.deleteMany({
        where: { id: { in: testData.accountEntryIds } }
      })
    }

    if (testData.transactionIds.length > 0) {
      await prisma.transaction.deleteMany({
        where: { id: { in: testData.transactionIds } }
      })
    }

    if (testData.loanPaymentIds.length > 0) {
      await prisma.loanPayment.deleteMany({
        where: { id: { in: testData.loanPaymentIds } }
      })
    }

    if (testData.leadPaymentReceivedIds.length > 0) {
      await prisma.leadPaymentReceived.deleteMany({
        where: { id: { in: testData.leadPaymentReceivedIds } }
      })
    }

    if (testData.loanIds.length > 0) {
      await prisma.loan.deleteMany({
        where: { id: { in: testData.loanIds } }
      })
    }

    if (testData.borrowerIds.length > 0) {
      await prisma.borrower.deleteMany({
        where: { id: { in: testData.borrowerIds } }
      })
    }

    if (testData.employeeIds.length > 0) {
      await prisma.employee.deleteMany({
        where: { id: { in: testData.employeeIds } }
      })
    }

    if (testData.loantypeIds.length > 0) {
      await prisma.loantype.deleteMany({
        where: { id: { in: testData.loantypeIds } }
      })
    }

    if (testData.accountIds.length > 0) {
      // Delete any AccountEntry linked to these accounts (even if not tracked)
      await prisma.accountEntry.deleteMany({
        where: { accountId: { in: testData.accountIds } }
      })

      await prisma.account.deleteMany({
        where: { id: { in: testData.accountIds } }
      })
    }

    if (testData.routeIds.length > 0) {
      await prisma.route.deleteMany({
        where: { id: { in: testData.routeIds } }
      })
    }

    if (testData.personalDataIds.length > 0) {
      await prisma.personalData.deleteMany({
        where: { id: { in: testData.personalDataIds } }
      })
    }
  } catch (error) {
    console.error('Error cleaning up test data:', error)
  }
})
