import { prisma } from '@solufacil/database'

async function main() {
  // Set the search path
  await prisma.$executeRawUnsafe(`SET search_path TO "solufacil_mono"`)

  // Check ONLY active loans snapshot distribution
  console.log('\n=== ACTIVE LOANS BY SNAPSHOT ROUTE ===')
  const activeBySnapshot = await prisma.$queryRaw`
    SELECT
      r.name as route_name,
      COUNT(*)::int as active_loan_count
    FROM "Loan" l
    LEFT JOIN "Route" r ON l."snapshotRouteId" = r.id
    WHERE l.status = 'ACTIVE'
    GROUP BY r.name
    ORDER BY active_loan_count DESC
  `
  console.log(activeBySnapshot)

  // Total active loans
  const totalActive = await prisma.$queryRaw`
    SELECT COUNT(*)::int as total FROM "Loan" WHERE status = 'ACTIVE'
  `
  console.log('\nTotal active loans:', totalActive)

  // Check ALL routes in the system
  console.log('\n=== ALL ROUTES IN SYSTEM ===')
  const allRoutes = await prisma.$queryRaw`
    SELECT id, name FROM "Route" ORDER BY name
  `
  console.log(allRoutes)

  // Check loans by lead's route (for comparison)
  console.log('\n=== ACTIVE LOANS BY LEAD ROUTE (M:M relation) ===')
  const activeByLeadRoute = await prisma.$queryRaw`
    SELECT
      r.name as route_name,
      COUNT(DISTINCT l.id)::int as active_loan_count
    FROM "Loan" l
    JOIN "Employee" e ON l.lead = e.id
    JOIN "_RouteEmployees" re ON e.id = re."B"
    JOIN "Route" r ON re."A" = r.id
    WHERE l.status = 'ACTIVE'
    GROUP BY r.name
    ORDER BY active_loan_count DESC
  `
  console.log(activeByLeadRoute)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
