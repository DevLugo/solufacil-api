import { prisma } from '@solufacil/database'

async function main() {
  await prisma.$executeRawUnsafe(`SET search_path TO "solufacil_mono"`)

  // Get the route distribution based on lead's assigned routes
  console.log('\n=== LOAN DISTRIBUTION BY LEAD ROUTE ===')
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

  const routeCount = new Map<string, number>()
  for (const loan of allLoans) {
    const routes = loan.leadRelation?.routes || []
    const routeName = routes.length > 0 ? routes[0].name : 'NO_LEAD_ROUTE'
    routeCount.set(routeName, (routeCount.get(routeName) || 0) + 1)
  }

  // Sort and display
  const sortedRoutes = Array.from(routeCount.entries()).sort((a, b) => b[1] - a[1])
  console.log('Distribution by lead route:')
  for (const [route, count] of sortedRoutes) {
    console.log(`  ${route}: ${count}`)
  }

  // Check what routes are assigned to leads
  console.log('\n=== ROUTES ASSIGNED TO LEADS ===')
  const leadsWithRoutes = await prisma.employee.findMany({
    where: { type: 'LEAD' },
    include: { routes: true },
  })

  const leadRouteNames = new Set<string>()
  for (const lead of leadsWithRoutes) {
    for (const route of lead.routes) {
      leadRouteNames.add(route.name)
    }
  }
  console.log('Routes assigned to leads:', Array.from(leadRouteNames))
  console.log('Total leads with routes:', leadsWithRoutes.filter(l => l.routes.length > 0).length)
  console.log('Total leads without routes:', leadsWithRoutes.filter(l => l.routes.length === 0).length)

  // Compare snapshotRouteId vs lead route for each loan
  console.log('\n=== SNAPSHOT vs LEAD ROUTE COMPARISON ===')
  const loansWithSnapshot = await prisma.loan.findMany({
    where: {
      pendingAmountStored: { gt: 0 },
      badDebtDate: null,
      excludedByCleanup: null,
      renewedDate: null,
      finishedDate: null,
    },
    include: {
      snapshotRoute: true,
      leadRelation: {
        include: {
          routes: true,
        },
      },
    },
  })

  const comparison = new Map<string, number>()
  for (const loan of loansWithSnapshot) {
    const snapshotRouteName = loan.snapshotRoute?.name || 'NULL'
    const leadRouteName = loan.leadRelation?.routes?.[0]?.name || 'NULL'
    const key = `snapshot:${snapshotRouteName} -> lead:${leadRouteName}`
    comparison.set(key, (comparison.get(key) || 0) + 1)
  }

  const sortedComparison = Array.from(comparison.entries()).sort((a, b) => b[1] - a[1])
  console.log('Snapshot route -> Lead route mapping:')
  for (const [mapping, count] of sortedComparison) {
    console.log(`  ${mapping}: ${count}`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
