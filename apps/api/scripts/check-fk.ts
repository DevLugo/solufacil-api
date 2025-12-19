import { Pool } from 'pg'

const pool = new Pool({
  connectionString: 'postgresql://postgres:test1234@localhost:5432/postgres',
})

async function main() {
  // Check FK constraints on _RouteEmployees
  console.log('\n=== FK CONSTRAINTS ON _RouteEmployees ===')
  const fks = await pool.query(`
    SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = '_RouteEmployees'
      AND tc.table_schema = 'solufacil_mono'
  `)
  console.log(fks.rows)

  // Check table structure
  console.log('\n=== TABLE STRUCTURE ===')
  const structure = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = '_RouteEmployees'
      AND table_schema = 'solufacil_mono'
    ORDER BY ordinal_position
  `)
  console.log(structure.rows)

  await pool.end()
}

main().catch(console.error)
