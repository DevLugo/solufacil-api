import { Pool } from 'pg'

const pool = new Pool({
  connectionString: 'postgresql://postgres:test1234@localhost:5432/postgres',
})

async function main() {
  // Check users in source schema
  console.log('\n=== USERS IN PUBLIC SCHEMA ===')
  const users = await pool.query(`SELECT * FROM "public"."User" LIMIT 10`)
  console.log('Count:', users.rowCount)
  console.log('Rows:', users.rows)

  // Check users in target schema
  console.log('\n=== USERS IN SOLUFACIL_MONO SCHEMA ===')
  const targetUsers = await pool.query(`SELECT * FROM "solufacil_mono"."User" LIMIT 10`)
  console.log('Count:', targetUsers.rowCount)
  console.log('Rows:', targetUsers.rows)

  // Check employees in source
  console.log('\n=== EMPLOYEES IN PUBLIC SCHEMA ===')
  const employees = await pool.query(`SELECT id, "user", type FROM "public"."Employee" WHERE "user" IS NOT NULL LIMIT 10`)
  console.log('Employees with user:', employees.rowCount)
  console.log('Sample:', employees.rows)

  await pool.end()
}

main().catch(console.error)
