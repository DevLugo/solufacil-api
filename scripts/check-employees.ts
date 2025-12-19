import { Pool } from 'pg'

const pool = new Pool({
  connectionString: 'postgresql://postgres:test1234@localhost:5432/postgres',
})

async function main() {
  // Check employees that have routes but don't exist in target
  console.log('\n=== EMPLOYEES WITH ROUTES THAT DONT EXIST IN TARGET ===')
  const missing = await pool.query(`
    SELECT e.id, e.type, e.routes, r.name as route_name
    FROM "public"."Employee" e
    LEFT JOIN "public"."Route" r ON e.routes = r.id
    WHERE e.routes IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "solufacil_mono"."Employee" WHERE id = e.id)
  `)
  console.log('Missing employees:', missing.rows.length)
  console.log(missing.rows)

  // Check total counts
  console.log('\n=== EMPLOYEE COUNTS ===')
  const sourceCount = await pool.query(`SELECT COUNT(*)::int as count FROM "public"."Employee"`)
  const targetCount = await pool.query(`SELECT COUNT(*)::int as count FROM "solufacil_mono"."Employee"`)
  console.log('Source:', sourceCount.rows[0].count)
  console.log('Target:', targetCount.rows[0].count)

  // Check why some weren't migrated
  console.log('\n=== EMPLOYEES NOT MIGRATED ===')
  const notMigrated = await pool.query(`
    SELECT e.id, e.type, e."personalData"
    FROM "public"."Employee" e
    WHERE NOT EXISTS (SELECT 1 FROM "solufacil_mono"."Employee" WHERE id = e.id)
  `)
  console.log(notMigrated.rows)

  await pool.end()
}

main().catch(console.error)
