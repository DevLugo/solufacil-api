import { prisma } from '@solufacil/database'

async function main() {
  await prisma.$executeRawUnsafe(`SET search_path TO "solufacil_mono"`)

  // Check raw _RouteEmployees
  console.log('\n=== RAW _ROUTEEMPLOYEES (first 10) ===')
  const raw = await prisma.$queryRaw`
    SELECT * FROM "_RouteEmployees" LIMIT 10
  `
  console.log(raw)

  // Check if A is route and B is employee
  console.log('\n=== CHECK A (should be Route) ===')
  const routeCheck = await prisma.$queryRaw`
    SELECT re."A", r.name
    FROM "_RouteEmployees" re
    LEFT JOIN "Route" r ON re."A" = r.id
    LIMIT 5
  `
  console.log(routeCheck)

  console.log('\n=== CHECK B (should be Employee) ===')
  const employeeCheck = await prisma.$queryRaw`
    SELECT re."B", e.type
    FROM "_RouteEmployees" re
    LEFT JOIN "Employee" e ON re."B" = e.id
    LIMIT 5
  `
  console.log(employeeCheck)

  // Compare with source
  console.log('\n=== SOURCE EMPLOYEE WITH ROUTES ===')
  const sourceEmployees = await prisma.$queryRaw`
    SELECT e.id, e.type, e.routes, r.name as route_name
    FROM "public"."Employee" e
    LEFT JOIN "public"."Route" r ON e.routes = r.id
    WHERE e.routes IS NOT NULL AND e.type = 'LEAD'
    LIMIT 10
  `
  console.log(sourceEmployees)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
