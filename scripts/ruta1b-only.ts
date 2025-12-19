import { prisma } from '@solufacil/database'

async function main() {
  await prisma.$executeRawUnsafe(`SET search_path TO "solufacil_mono"`)

  // Find leads who are ONLY in RUTA1B (no other routes)
  const ruta1bOnly = await prisma.employee.findMany({
    where: {
      type: 'LEAD',
      routes: { every: { name: 'RUTA1B' } },
    },
    include: {
      routes: true,
      personalDataRelation: true,
    },
  })

  console.log('Leads ONLY in RUTA1B:', ruta1bOnly.length)

  let totalActiveLoans = 0
  for (const lead of ruta1bOnly) {
    const loanCount = await prisma.loan.count({
      where: {
        lead: lead.id,
        pendingAmountStored: { gt: 0 },
        badDebtDate: null,
        excludedByCleanup: null,
        renewedDate: null,
        finishedDate: null,
      },
    })
    totalActiveLoans += loanCount
    if (loanCount > 0) {
      console.log({
        name: lead.personalDataRelation?.fullName,
        routes: lead.routes.map(r => r.name),
        activeLoans: loanCount,
      })
    }
  }
  console.log('Total active loans from RUTA1B-only leads:', totalActiveLoans)

  // Check the current snapshotRouteId for these leads' loans
  console.log('\n=== SNAPSHOT ROUTE FOR RUTA1B-ONLY LEADS LOANS ===')
  for (const lead of ruta1bOnly) {
    const loans = await prisma.loan.findMany({
      where: {
        lead: lead.id,
        pendingAmountStored: { gt: 0 },
        badDebtDate: null,
        excludedByCleanup: null,
        renewedDate: null,
        finishedDate: null,
      },
      include: {
        snapshotRoute: true,
      },
      take: 3,
    })
    if (loans.length > 0) {
      console.log({
        leadName: lead.personalDataRelation?.fullName,
        sampleLoans: loans.map(l => ({
          loanId: l.id,
          snapshotRouteId: l.snapshotRouteId,
          snapshotRouteName: l.snapshotRoute?.name || l.snapshotRouteName,
        })),
      })
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
