import { Pool } from 'pg'

const pool = new Pool({
  connectionString: 'postgresql://postgres:test1234@localhost:5432/postgres',
})

async function main() {
  // Check what we're trying to insert
  console.log('\n=== SOURCE DATA TO INSERT ===')
  const sourceData = await pool.query(`
    SELECT e.id as employee_id, e.routes as route_id, e.type
    FROM "public"."Employee" e
    WHERE e.routes IS NOT NULL
      AND EXISTS (SELECT 1 FROM "solufacil_mono"."Employee" WHERE id = e.id)
      AND EXISTS (SELECT 1 FROM "solufacil_mono"."Route" WHERE id = e.routes)
    LIMIT 10
  `)
  console.log('Source rows:', sourceData.rows)

  // Check if the route IDs exist in Route table
  console.log('\n=== ALL ROUTES IN TARGET ===')
  const routes = await pool.query(`SELECT id, name FROM "solufacil_mono"."Route"`)
  console.log(routes.rows)

  // Check which route IDs from source don't exist in target
  console.log('\n=== CHECK IF ROUTE IDS EXIST ===')
  const check = await pool.query(`
    SELECT DISTINCT e.routes as route_id, r.name
    FROM "public"."Employee" e
    LEFT JOIN "solufacil_mono"."Route" r ON e.routes = r.id
    WHERE e.routes IS NOT NULL
    ORDER BY route_id
  `)
  console.log(check.rows)

  await pool.end()
}

main().catch(console.error)
