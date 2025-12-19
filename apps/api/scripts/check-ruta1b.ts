import { prisma } from '@solufacil/database'

async function main() {
  await prisma.$executeRawUnsafe(`SET search_path TO "solufacil_mono"`)

  // Get RUTA1B ID
  const ruta1b = await prisma.route.findFirst({
    where: { name: 'RUTA1B' },
  })
  console.log('RUTA1B route:', ruta1b)

  if (!ruta1b) {
    console.log('RUTA1B not found!')
    return
  }

  // Check if any active loans have RUTA1B as snapshotRouteId
  const loansWithRuta1b = await prisma.loan.count({
    where: {
      snapshotRouteId: ruta1b.id,
      pendingAmountStored: { gt: 0 },
      badDebtDate: null,
      excludedByCleanup: null,
      renewedDate: null,
      finishedDate: null,
    },
  })
  console.log('\nActive loans with snapshotRouteId = RUTA1B:', loansWithRuta1b)

  // Check ALL loans (not just active) with RUTA1B
  const allLoansWithRuta1b = await prisma.loan.count({
    where: { snapshotRouteId: ruta1b.id },
  })
  console.log('ALL loans with snapshotRouteId = RUTA1B:', allLoansWithRuta1b)

  // Check what leads are in RUTA1B (via M:M)
  const leadsInRuta1b = await prisma.employee.findMany({
    where: {
      type: 'LEAD',
      routes: { some: { id: ruta1b.id } },
    },
    include: {
      personalDataRelation: {
        include: {
          addresses: {
            include: {
              locationRelation: {
                include: {
                  routeRelation: true,
                },
              },
            },
          },
        },
      },
    },
  })

  console.log('\n=== LEADS ASSIGNED TO RUTA1B (M:M) ===')
  console.log('Total leads:', leadsInRuta1b.length)

  for (const lead of leadsInRuta1b.slice(0, 10)) {
    const locality = lead.personalDataRelation?.addresses?.[0]?.locationRelation
    const localityRoute = locality?.routeRelation
    console.log({
      leadId: lead.id,
      localityName: locality?.name || 'NO_LOCALITY',
      localityRouteId: localityRoute?.id || 'NO_ROUTE',
      localityRouteName: localityRoute?.name || 'NO_ROUTE',
    })
  }

  // Check what localities (and their routes) the RUTA1B leads have
  console.log('\n=== LOCALITY ROUTES FOR RUTA1B LEADS ===')
  const localityRouteCount = new Map<string, number>()
  for (const lead of leadsInRuta1b) {
    const localityRouteName = lead.personalDataRelation?.addresses?.[0]?.locationRelation?.routeRelation?.name || 'NO_LOCALITY_ROUTE'
    localityRouteCount.set(localityRouteName, (localityRouteCount.get(localityRouteName) || 0) + 1)
  }
  console.log(Object.fromEntries(localityRouteCount))
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
