import { prisma } from '@solufacil/database'

async function main() {
  await prisma.$executeRawUnsafe(`SET search_path TO "solufacil_mono"`)

  // Check what employees are in _RouteEmployees and what routes they have
  console.log('\n=== EMPLOYEES IN _RouteEmployees WITH THEIR ROUTES ===')
  const employeesWithRoutes = await prisma.$queryRaw`
    SELECT
      e.id as employee_id,
      e.type as employee_type,
      pd."fullName" as name,
      STRING_AGG(r.name, ', ') as routes
    FROM "Employee" e
    JOIN "_RouteEmployees" re ON e.id = re."B"
    JOIN "Route" r ON re."A" = r.id
    LEFT JOIN "PersonalData" pd ON e."personalData" = pd.id
    GROUP BY e.id, e.type, pd."fullName"
    ORDER BY e.type
  `
  console.log(employeesWithRoutes)

  // Check if active loans have leads that are in _RouteEmployees
  console.log('\n=== ACTIVE LOANS WITH LEAD INFO ===')
  const loansWithLeadRoutes = await prisma.$queryRaw`
    SELECT
      l.id as loan_id,
      l.lead as lead_id,
      e.type as employee_type,
      STRING_AGG(DISTINCT r.name, ', ') as lead_routes,
      r2.name as snapshot_route_name
    FROM "Loan" l
    LEFT JOIN "Employee" e ON l.lead = e.id
    LEFT JOIN "_RouteEmployees" re ON e.id = re."B"
    LEFT JOIN "Route" r ON re."A" = r.id
    LEFT JOIN "Route" r2 ON l."snapshotRouteId" = r2.id
    WHERE l.status = 'ACTIVE'
      AND l."renewedDate" IS NULL
      AND l."finishedDate" IS NULL
    GROUP BY l.id, l.lead, e.type, r2.name
    LIMIT 20
  `
  console.log(loansWithLeadRoutes)

  // Count how many active loans have leads with routes
  console.log('\n=== COUNT OF ACTIVE LOANS WITH LEAD HAVING ROUTES ===')
  const countLoansWithLeadRoutes = await prisma.$queryRaw`
    SELECT
      CASE
        WHEN EXISTS(SELECT 1 FROM "_RouteEmployees" re WHERE re."B" = l.lead) THEN 'lead_has_route'
        ELSE 'lead_no_route'
      END as status,
      COUNT(*)::int as count
    FROM "Loan" l
    WHERE l.status = 'ACTIVE'
      AND l."renewedDate" IS NULL
      AND l."finishedDate" IS NULL
      AND l."pendingAmountStored" > 0
      AND l."badDebtDate" IS NULL
      AND l."excludedByCleanup" IS NULL
    GROUP BY CASE WHEN EXISTS(SELECT 1 FROM "_RouteEmployees" re WHERE re."B" = l.lead) THEN 'lead_has_route' ELSE 'lead_no_route' END
  `
  console.log(countLoansWithLeadRoutes)

  // Check snapshotRouteId distribution for loans without lead routes
  console.log('\n=== SNAPSHOT ROUTE DISTRIBUTION FOR LOANS WITHOUT LEAD ROUTES ===')
  const snapshotDistNoLeadRoute = await prisma.$queryRaw`
    SELECT
      r.name as snapshot_route,
      COUNT(*)::int as count
    FROM "Loan" l
    LEFT JOIN "Route" r ON l."snapshotRouteId" = r.id
    WHERE l.status = 'ACTIVE'
      AND l."renewedDate" IS NULL
      AND l."finishedDate" IS NULL
      AND l."pendingAmountStored" > 0
      AND l."badDebtDate" IS NULL
      AND l."excludedByCleanup" IS NULL
      AND NOT EXISTS(SELECT 1 FROM "_RouteEmployees" re WHERE re."B" = l.lead)
    GROUP BY r.name
    ORDER BY count DESC
  `
  console.log(snapshotDistNoLeadRoute)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
