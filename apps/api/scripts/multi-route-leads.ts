import { prisma } from '@solufacil/database'

async function main() {
  await prisma.$executeRawUnsafe(`SET search_path TO "solufacil_mono"`)

  // Check leads with multiple routes
  console.log('\n=== LEADS WITH MULTIPLE ROUTES ===')
  const leadsWithMultipleRoutes = await prisma.employee.findMany({
    where: {
      type: 'LEAD',
    },
    include: {
      routes: true,
      personalDataRelation: true,
    },
  })

  const multiRouteLeads = leadsWithMultipleRoutes.filter(l => l.routes.length > 1)
  console.log('Leads with multiple routes:', multiRouteLeads.length)
  console.log('Leads with single route:', leadsWithMultipleRoutes.length - multiRouteLeads.length)

  for (const lead of multiRouteLeads) {
    console.log({
      name: lead.personalDataRelation?.fullName,
      routes: lead.routes.map(r => r.name),
    })
  }

  // Check what would be selected with ORDER BY r.name
  console.log('\n=== ALPHABETICAL ROUTE SELECTION ===')
  const routes = await prisma.route.findMany({
    orderBy: { name: 'asc' },
  })
  console.log('Routes sorted alphabetically:', routes.map(r => r.name))

  // Check which leads are assigned to RUTA1B AND also to RUTA 3A or RUTA 3B
  console.log('\n=== LEADS IN RUTA1B WHO ARE ALSO IN RUTA 3A/3B ===')
  const ruta1bLeadsWithOther = await prisma.employee.findMany({
    where: {
      type: 'LEAD',
      routes: {
        some: { name: 'RUTA1B' },
      },
      AND: {
        routes: {
          some: { name: { in: ['RUTA 3A', 'RUTA 3B'] } },
        },
      },
    },
    include: {
      routes: true,
      personalDataRelation: true,
    },
  })

  console.log('Leads in RUTA1B AND RUTA 3A/3B:', ruta1bLeadsWithOther.length)
  for (const lead of ruta1bLeadsWithOther) {
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
    console.log({
      name: lead.personalDataRelation?.fullName,
      routes: lead.routes.map(r => r.name),
      activeLoans: loanCount,
    })
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
