import { prisma } from '@solufacil/database'

async function main() {
  await prisma.$executeRawUnsafe(`SET search_path TO "solufacil_mono"`)

  // Check snapshotRouteId distribution - exact same conditions as PortfolioReportService
  console.log('\n=== EXACT SAME CONDITIONS AS PORTFOLIO SERVICE ===')
  const exactMatch = await prisma.loan.groupBy({
    by: ['snapshotRouteId'],
    where: {
      pendingAmountStored: { gt: 0 },
      badDebtDate: null,
      excludedByCleanup: null,
      renewedDate: null,
      finishedDate: null,
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  })

  console.log('Grouped by snapshotRouteId:', exactMatch)
  console.log('Total loans:', exactMatch.reduce((sum, g) => sum + g._count.id, 0))

  // Now get the route names
  console.log('\n=== WITH ROUTE NAMES ===')
  const routeIds = exactMatch.map(g => g.snapshotRouteId).filter(Boolean)
  const routes = await prisma.route.findMany({
    where: { id: { in: routeIds as string[] } },
  })
  const routeMap = new Map(routes.map(r => [r.id, r.name]))

  for (const group of exactMatch) {
    console.log({
      routeName: routeMap.get(group.snapshotRouteId || '') || 'NULL',
      snapshotRouteId: group.snapshotRouteId,
      count: group._count.id,
    })
  }

  // Check if leadRelation.routes has any data
  console.log('\n=== CHECK LEAD RELATION ROUTES ===')
  const loansWithLeadRoutes = await prisma.loan.findMany({
    where: {
      pendingAmountStored: { gt: 0 },
      badDebtDate: null,
      excludedByCleanup: null,
      renewedDate: null,
      finishedDate: null,
    },
    include: {
      leadRelation: {
        include: {
          routes: true,
        },
      },
    },
    take: 10,
  })

  console.log('Sample loans with lead routes:')
  for (const loan of loansWithLeadRoutes) {
    console.log({
      loanId: loan.id,
      leadId: loan.lead,
      leadRoutes: loan.leadRelation?.routes?.map(r => r.name) || [],
      routesLength: loan.leadRelation?.routes?.length || 0,
    })
  }

  // Count how many loans have lead with routes
  const allLoans = await prisma.loan.findMany({
    where: {
      pendingAmountStored: { gt: 0 },
      badDebtDate: null,
      excludedByCleanup: null,
      renewedDate: null,
      finishedDate: null,
    },
    include: {
      leadRelation: {
        include: {
          routes: true,
        },
      },
    },
  })

  let withRoutes = 0
  let withoutRoutes = 0
  for (const loan of allLoans) {
    if (loan.leadRelation?.routes && loan.leadRelation.routes.length > 0) {
      withRoutes++
    } else {
      withoutRoutes++
    }
  }

  console.log('\n=== FINAL STATS ===')
  console.log('Loans with lead having routes:', withRoutes)
  console.log('Loans without lead routes:', withoutRoutes)
  console.log('Total:', withRoutes + withoutRoutes)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
