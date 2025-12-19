import { prisma } from '@solufacil/database'

async function main() {
  await prisma.$executeRawUnsafe(`SET search_path TO "solufacil_mono"`)

  // Check _RouteEmployees
  console.log('\n=== _ROUTEEMPLOYEES CONTENT ===')
  const routeEmployees = await prisma.$queryRaw`
    SELECT COUNT(*)::int as count FROM "_RouteEmployees"
  `
  console.log('Total records:', routeEmployees)

  // Check if leads have routes
  console.log('\n=== LEADS WITH ROUTES ===')
  const leadsWithRoutes = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT e.id)::int as count
    FROM "Employee" e
    JOIN "_RouteEmployees" re ON e.id = re."B"
    WHERE e.type = 'LEAD'
  `
  console.log('Leads with routes:', leadsWithRoutes)

  // Run the sync
  console.log('\n=== RUNNING SYNC ===')
  const updateResult = await prisma.$executeRaw`
    UPDATE "Loan" l
    SET "snapshotRouteId" = subq.route_id
    FROM (
      SELECT DISTINCT ON (e.id)
        e.id as employee_id,
        r.id as route_id
      FROM "Employee" e
      JOIN "_RouteEmployees" re ON e.id = re."B"
      JOIN "Route" r ON re."A" = r.id
      WHERE e.type = 'LEAD'
      ORDER BY e.id, r.name
    ) subq
    WHERE l.lead = subq.employee_id
  `
  console.log('Rows updated:', updateResult)

  // Check result
  console.log('\n=== RESULT AFTER SYNC ===')
  const result = await prisma.$queryRaw`
    SELECT
      r.name as route_name,
      COUNT(*)::int as count
    FROM "Loan" l
    LEFT JOIN "Route" r ON l."snapshotRouteId" = r.id
    WHERE l."pendingAmountStored" > 0
      AND l."badDebtDate" IS NULL
      AND l."excludedByCleanup" IS NULL
      AND l."renewedDate" IS NULL
      AND l."finishedDate" IS NULL
    GROUP BY r.name
    ORDER BY count DESC
  `
  console.log(result)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
