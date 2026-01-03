import { prisma } from '@solufacil/database'

async function main() {
  // Total loans with pending amount
  const totalPending = await prisma.loan.count({
    where: { pendingAmountStored: { gt: 0 } }
  })

  // Loans excluded by cleanup
  const excluded = await prisma.loan.count({
    where: {
      pendingAmountStored: { gt: 0 },
      excludedByCleanup: { not: null }
    }
  })

  // Loans with finishedDate
  const finished = await prisma.loan.count({
    where: {
      pendingAmountStored: { gt: 0 },
      finishedDate: { not: null }
    }
  })

  // Loans with renewedDate
  const renewed = await prisma.loan.count({
    where: {
      pendingAmountStored: { gt: 0 },
      renewedDate: { not: null }
    }
  })

  // Active loans (matching web dashboard logic)
  const activeLoans = await prisma.loan.count({
    where: {
      pendingAmountStored: { gt: 0 },
      excludedByCleanup: null,
      finishedDate: null,
      renewedDate: null,
    }
  })

  console.log('=== LOAN COUNTS ===')
  console.log(`Total with pending > 0: ${totalPending}`)
  console.log(`Excluded by cleanup:    ${excluded}`)
  console.log(`With finishedDate:      ${finished}`)
  console.log(`With renewedDate:       ${renewed}`)
  console.log(``)
  console.log(`Active loans (all filters): ${activeLoans}`)
  console.log(``)
  console.log(`Difference (${totalPending} - ${activeLoans} = ${totalPending - activeLoans})`)
}

main()
  .catch(console.error)
  .finally(() => process.exit(0))
