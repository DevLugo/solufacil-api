import { prisma } from '@solufacil/database'

const schema = 'solufacil_mono'

async function main() {
  // Set the search path
  await prisma.$executeRawUnsafe(`SET search_path TO "${schema}"`)

  // Check leads with multiple routes
  console.log('\n=== LEADS WITH MULTIPLE ROUTES ===')
  const leadsWithMultipleRoutes = await prisma.$queryRaw`
    SELECT
      e.id as employee_id,
      pd."fullName" as lead_name,
      COUNT(DISTINCT r.id)::int as route_count,
      STRING_AGG(r.name, ', ' ORDER BY r.name) as routes
    FROM "Employee" e
    JOIN "_RouteEmployees" re ON e.id = re."B"
    JOIN "Route" r ON re."A" = r.id
    JOIN "PersonalData" pd ON e."personalData" = pd.id
    WHERE e.type = 'LEAD'
    GROUP BY e.id, pd."fullName"
    HAVING COUNT(DISTINCT r.id) > 1
    ORDER BY COUNT(DISTINCT r.id) DESC
  `
  console.log(leadsWithMultipleRoutes)

  // Check current state of snapshotRouteId distribution
  console.log('\n=== CURRENT SNAPSHOT ROUTE ID DISTRIBUTION ===')
  const snapshotDist = await prisma.$queryRaw`
    SELECT
      r.name as route_name,
      COUNT(*)::int as loan_count
    FROM "Loan" l
    LEFT JOIN "Route" r ON l."snapshotRouteId" = r.id
    WHERE l.status = 'ACTIVE'
    GROUP BY r.name
    ORDER BY loan_count DESC
  `
  console.log(snapshotDist)

  // Check leads assigned to RUTA1B and their loans
  console.log('\n=== LEADS ONLY IN RUTA1B (NOT IN OTHER ROUTES) ===')
  const ruta1bOnlyLeads = await prisma.$queryRaw`
    SELECT
      e.id as lead_id,
      pd."fullName" as lead_name,
      COUNT(DISTINCT l.id)::int as active_loan_count
    FROM "Employee" e
    JOIN "_RouteEmployees" re ON e.id = re."B"
    JOIN "Route" r ON re."A" = r.id
    JOIN "PersonalData" pd ON e."personalData" = pd.id
    LEFT JOIN "Loan" l ON l.lead = e.id AND l.status = 'ACTIVE'
    WHERE r.name = 'RUTA1B'
      AND e.type = 'LEAD'
      AND NOT EXISTS (
        SELECT 1 FROM "_RouteEmployees" re2
        JOIN "Route" r2 ON re2."A" = r2.id
        WHERE re2."B" = e.id AND r2.name != 'RUTA1B'
      )
    GROUP BY e.id, pd."fullName"
    ORDER BY active_loan_count DESC
  `
  console.log(ruta1bOnlyLeads)

  // Check what happened - compare snapshotRouteId vs lead's actual routes
  console.log('\n=== LOANS WHERE SNAPSHOT DIFFERS FROM LEAD ROUTE ===')
  const mismatches = await prisma.$queryRaw`
    SELECT
      r_snapshot.name as snapshot_route,
      r_lead.name as lead_route,
      COUNT(*)::int as loan_count
    FROM "Loan" l
    JOIN "Employee" e ON l.lead = e.id
    JOIN "_RouteEmployees" re ON e.id = re."B"
    JOIN "Route" r_lead ON re."A" = r_lead.id
    LEFT JOIN "Route" r_snapshot ON l."snapshotRouteId" = r_snapshot.id
    WHERE l.status = 'ACTIVE'
    GROUP BY r_snapshot.name, r_lead.name
    ORDER BY loan_count DESC
  `
  console.log(mismatches)

  // Check if there are loans with leads who are ONLY assigned to RUTA1B
  console.log('\n=== ACTIVE LOANS WITH LEADS ONLY IN RUTA1B ===')
  const loansRuta1bOnly = await prisma.$queryRaw`
    SELECT COUNT(*)::int as count
    FROM "Loan" l
    JOIN "Employee" e ON l.lead = e.id
    JOIN "_RouteEmployees" re ON e.id = re."B"
    JOIN "Route" r ON re."A" = r.id
    WHERE l.status = 'ACTIVE'
      AND r.name = 'RUTA1B'
      AND NOT EXISTS (
        SELECT 1 FROM "_RouteEmployees" re2
        JOIN "Route" r2 ON re2."A" = r2.id
        WHERE re2."B" = e.id AND r2.name != 'RUTA1B'
      )
  `
  console.log(loansRuta1bOnly)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
