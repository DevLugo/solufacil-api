import { prisma } from '@solufacil/database'

async function main() {
  await prisma.$executeRawUnsafe(`SET search_path TO "solufacil_mono"`)

  // Check employee types in _RouteEmployees
  console.log('\n=== EMPLOYEE TYPES IN _ROUTEEMPLOYEES ===')
  const types = await prisma.$queryRaw`
    SELECT e.type, COUNT(*)::int as count
    FROM "_RouteEmployees" re
    JOIN "Employee" e ON re."B" = e.id
    GROUP BY e.type
  `
  console.log(types)

  // Check what employees are LEADs
  console.log('\n=== TOTAL LEADS IN EMPLOYEE ===')
  const leads = await prisma.$queryRaw`
    SELECT COUNT(*)::int as count FROM "Employee" WHERE type = 'LEAD'
  `
  console.log(leads)

  // Check original source data
  console.log('\n=== SOURCE EMPLOYEE-ROUTES RELATION ===')
  const sourceRoutes = await prisma.$queryRaw`
    SELECT e.type, COUNT(*)::int as count
    FROM "public"."Employee" e
    WHERE e.routes IS NOT NULL
    GROUP BY e.type
  `
  console.log(sourceRoutes)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
