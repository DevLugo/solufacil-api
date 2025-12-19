/**
 * Script para crear un usuario admin de prueba
 *
 * Uso: npx tsx scripts/create-admin-user.ts
 */

import 'dotenv/config'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'

const TARGET_SCHEMA = 'solufacil_mono'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

async function createAdminUser() {
  const email = 'elugo.isi@gmail.com'
  const password = '1234'
  const name = 'Admin User'
  const role = 'ADMIN'

  // Hash password with bcrypt (10 rounds)
  const hashedPassword = await bcrypt.hash(password, 10)
  const id = randomUUID().replace(/-/g, '').slice(0, 25) // Generate CUID-like ID

  console.log('Creating admin user...')
  console.log(`  Email: ${email}`)
  console.log(`  Role: ${role}`)

  try {
    // Check if user already exists
    const existing = await pool.query(
      `SELECT id FROM "${TARGET_SCHEMA}"."User" WHERE email = $1`,
      [email]
    )

    if (existing.rows.length > 0) {
      console.log('\n⚠️  User already exists, updating password...')
      await pool.query(
        `UPDATE "${TARGET_SCHEMA}"."User" SET password = $1, role = $2::"${TARGET_SCHEMA}"."UserRole" WHERE email = $3`,
        [hashedPassword, role, email]
      )
      console.log('✅ Password updated!')
    } else {
      await pool.query(
        `INSERT INTO "${TARGET_SCHEMA}"."User" (id, name, email, password, role, "createdAt")
         VALUES ($1, $2, $3, $4, $5::"${TARGET_SCHEMA}"."UserRole", NOW())`,
        [id, name, email, hashedPassword, role]
      )
      console.log('✅ Admin user created!')
    }

    // Verify
    const result = await pool.query(
      `SELECT id, name, email, role, "createdAt" FROM "${TARGET_SCHEMA}"."User" WHERE email = $1`,
      [email]
    )
    console.log('\nUser details:')
    console.log(result.rows[0])

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await pool.end()
  }
}

createAdminUser()
