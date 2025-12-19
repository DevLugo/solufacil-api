import { Pool } from 'pg'

const pool = new Pool({
  connectionString: 'postgresql://postgres:test1234@localhost:5432/postgres',
})

async function main() {
  // Check RUTA1B in source
  console.log('\n=== RUTA1B IN SOURCE ===')
  const ruta1b = await pool.query(`
    SELECT id, name FROM "public"."Route" WHERE name = 'RUTA1B'
  `)
  console.log('Route:', ruta1b.rows)

  if (ruta1b.rows.length === 0) {
    console.log('RUTA1B not found in source!')
    await pool.end()
    return
  }

  const ruta1bId = ruta1b.rows[0].id

  // Check active loans with snapshotRouteId = RUTA1B in source
  console.log('\n=== SOURCE ACTIVE LOANS WITH RUTA1B ===')
  const sourceLoans = await pool.query(`
    SELECT COUNT(*)::int as count
    FROM "public"."Loan"
    WHERE "snapshotRouteId" = $1
      AND "pendingAmountStored" > 0
      AND "badDebtDate" IS NULL
      AND "excludedByCleanup" IS NULL
      AND "renewedDate" IS NULL
      AND "finishedDate" IS NULL
  `, [ruta1bId])
  console.log('Source loans with RUTA1B:', sourceLoans.rows[0].count)

  // Check employees assigned to RUTA1B
  console.log('\n=== EMPLOYEES ASSIGNED TO RUTA1B ===')
  const employees = await pool.query(`
    SELECT e.id, e.type, pd."fullName"
    FROM "public"."Employee" e
    LEFT JOIN "public"."PersonalData" pd ON e."personalData" = pd.id
    WHERE e.routes = $1
  `, [ruta1bId])
  console.log('Employees:', employees.rows.length)
  console.log(employees.rows.slice(0, 5))

  await pool.end()
}

main().catch(console.error)
