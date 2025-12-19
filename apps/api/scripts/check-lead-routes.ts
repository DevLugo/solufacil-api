import { prisma } from '@solufacil/database'

async function main() {
  await prisma.$executeRawUnsafe(`SET search_path TO "solufacil_mono"`)

  // Check _RouteEmployees table content
  console.log('\n=== _RouteEmployees CONTENT (first 10) ===')
  const routeEmployees = await prisma.$queryRaw`
    SELECT re."A" as route_id, re."B" as employee_id, r.name as route_name
    FROM "_RouteEmployees" re
    JOIN "Route" r ON re."A" = r.id
    LIMIT 10
  `
  console.log(routeEmployees)

  // Check how many employees are in _RouteEmployees
  console.log('\n=== TOTAL EMPLOYEES IN _RouteEmployees ===')
  const totalInRelation = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT "B")::int as employee_count FROM "_RouteEmployees"
  `
  console.log(totalInRelation)

  // Check how many LEADs there are
  console.log('\n=== TOTAL LEADS IN SYSTEM ===')
  const totalLeads = await prisma.$queryRaw`
    SELECT COUNT(*)::int as lead_count FROM "Employee" WHERE type = 'LEAD'
  `
  console.log(totalLeads)

  // Check if any leads are in _RouteEmployees
  console.log('\n=== LEADS IN _RouteEmployees ===')
  const leadsInRelation = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT e.id)::int as lead_count
    FROM "Employee" e
    JOIN "_RouteEmployees" re ON e.id = re."B"
    WHERE e.type = 'LEAD'
  `
  console.log(leadsInRelation)

  // Check active loans and their leads
  console.log('\n=== ACTIVE LOANS WITH LEAD INFO ===')
  const loansWithLeads = await prisma.$queryRaw`
    SELECT
      l.id as loan_id,
      l.lead as lead_id,
      e.type as employee_type,
      EXISTS(SELECT 1 FROM "_RouteEmployees" re WHERE re."B" = e.id) as lead_has_route
    FROM "Loan" l
    LEFT JOIN "Employee" e ON l.lead = e.id
    WHERE l.status = 'ACTIVE'
    LIMIT 10
  `
  console.log(loansWithLeads)

  // Check how many active loans have a lead
  console.log('\n=== ACTIVE LOANS WITH/WITHOUT LEAD ===')
  const loanLeadStats = await prisma.$queryRaw`
    SELECT
      CASE
        WHEN l.lead IS NULL THEN 'NO_LEAD'
        ELSE 'HAS_LEAD'
      END as status,
      COUNT(*)::int as count
    FROM "Loan" l
    WHERE l.status = 'ACTIVE'
    GROUP BY CASE WHEN l.lead IS NULL THEN 'NO_LEAD' ELSE 'HAS_LEAD' END
  `
  console.log(loanLeadStats)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
