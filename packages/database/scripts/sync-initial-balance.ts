/**
 * Script para crear entries INITIAL_BALANCE
 *
 * Este script crea un entry de tipo INITIAL_BALANCE para cada cuenta,
 * sincronizando el balance actual (Account.amount) con el ledger (AccountEntry).
 *
 * Esto permite que a partir de este momento:
 * - Balance = SUM(AccountEntry) sea correcto
 * - Todas las nuevas operaciones usen AccountEntry
 *
 * Uso:
 *   npx tsx scripts/sync-initial-balance.ts           # Ejecutar
 *   npx tsx scripts/sync-initial-balance.ts --dry-run # Solo mostrar qué se haría
 *
 * Variables de entorno:
 *   DATABASE_URL - URL de la base de datos
 */

import 'dotenv/config'
import { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL
const DRY_RUN = process.argv.includes('--dry-run')

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL no está definida')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL })

interface AccountInfo {
  id: string
  name: string
  type: string
  amount: string
  hasInitialEntry: boolean
}

async function main() {
  console.log('═'.repeat(60))
  console.log('🏦 Sync Initial Balance - Crear entries INITIAL_BALANCE')
  console.log('═'.repeat(60))
  console.log('')

  if (DRY_RUN) {
    console.log('⚠️  Modo DRY-RUN: No se crearán entries\n')
  }

  const client = await pool.connect()

  try {
    // Verificar conexión
    await client.query('SELECT 1')
    console.log('✅ Conexión a base de datos OK\n')

    // Verificar que la tabla AccountEntry existe
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'AccountEntry'
      )
    `)

    if (!tableExists.rows[0].exists) {
      console.error('❌ La tabla AccountEntry no existe. Ejecuta la migración primero.')
      process.exit(1)
    }

    // Obtener todas las cuentas con su balance actual
    const accountsResult = await client.query(`
      SELECT
        a.id,
        a.name,
        a.type,
        a.amount::text,
        EXISTS (
          SELECT 1 FROM "AccountEntry" ae
          WHERE ae."accountId" = a.id
          AND ae."sourceType" = 'INITIAL_BALANCE'
        ) as "hasInitialEntry"
      FROM "Account" a
      ORDER BY a.type, a.name
    `)

    const accounts: AccountInfo[] = accountsResult.rows

    console.log(`📊 Cuentas encontradas: ${accounts.length}\n`)

    // Estadísticas
    const withEntry = accounts.filter(a => a.hasInitialEntry).length
    const withoutEntry = accounts.filter(a => !a.hasInitialEntry).length
    const zeroBalance = accounts.filter(a => parseFloat(a.amount) === 0).length

    console.log(`   • Con INITIAL_BALANCE existente: ${withEntry}`)
    console.log(`   • Sin INITIAL_BALANCE: ${withoutEntry}`)
    console.log(`   • Con balance cero: ${zeroBalance}`)
    console.log('')

    // Filtrar cuentas que necesitan entry
    const needsEntry = accounts.filter(a => !a.hasInitialEntry && parseFloat(a.amount) !== 0)

    if (needsEntry.length === 0) {
      console.log('✅ Todas las cuentas ya tienen INITIAL_BALANCE o balance cero.\n')
      return
    }

    console.log(`🔧 Cuentas que recibirán INITIAL_BALANCE: ${needsEntry.length}\n`)

    // Mostrar detalle
    console.log('   Cuenta                          | Tipo                | Balance')
    console.log('   ' + '-'.repeat(70))

    for (const account of needsEntry) {
      const name = account.name.padEnd(30).slice(0, 30)
      const type = account.type.padEnd(18).slice(0, 18)
      const balance = parseFloat(account.amount).toLocaleString('es-MX', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      console.log(`   ${name} | ${type} | $${balance}`)
    }

    console.log('')

    if (DRY_RUN) {
      console.log('⚠️  Modo DRY-RUN: No se ejecutaron cambios.\n')
      return
    }

    // Crear entries INITIAL_BALANCE
    console.log('📝 Creando entries INITIAL_BALANCE...\n')

    let created = 0
    let errors = 0

    await client.query('BEGIN')

    try {
      for (const account of needsEntry) {
        const amount = parseFloat(account.amount)
        const entryType = amount >= 0 ? 'CREDIT' : 'DEBIT'
        const absAmount = Math.abs(amount)

        try {
          await client.query(`
            INSERT INTO "AccountEntry" (
              id,
              "accountId",
              amount,
              "entryType",
              "sourceType",
              description,
              "entryDate",
              "createdAt",
              "syncId"
            ) VALUES (
              gen_random_uuid(),
              $1,
              $2,
              $3::"AccountEntryType",
              'INITIAL_BALANCE'::"SourceType",
              'Balance inicial sincronizado desde Account.amount',
              NOW(),
              NOW(),
              gen_random_uuid()
            )
          `, [account.id, absAmount, entryType])

          created++
          process.stdout.write(`\r   Creados: ${created}/${needsEntry.length}`)
        } catch (err) {
          errors++
          console.error(`\n   ❌ Error en ${account.name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      await client.query('COMMIT')
      console.log('\n')

    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }

    // Verificar reconciliación
    console.log('🔍 Verificando reconciliación...\n')

    const reconcileResult = await client.query(`
      SELECT
        a.id,
        a.name,
        a.amount::numeric as stored_balance,
        COALESCE(
          (SELECT SUM(
            CASE WHEN ae."entryType" = 'CREDIT' THEN ae.amount::numeric
                 ELSE -ae.amount::numeric END
          ) FROM "AccountEntry" ae WHERE ae."accountId" = a.id),
          0
        ) as calculated_balance,
        a.amount::numeric - COALESCE(
          (SELECT SUM(
            CASE WHEN ae."entryType" = 'CREDIT' THEN ae.amount::numeric
                 ELSE -ae.amount::numeric END
          ) FROM "AccountEntry" ae WHERE ae."accountId" = a.id),
          0
        ) as difference
      FROM "Account" a
      WHERE a.id IN (${needsEntry.map((_, i) => `$${i + 1}`).join(', ')})
    `, needsEntry.map(a => a.id))

    let consistent = 0
    let inconsistent = 0

    for (const row of reconcileResult.rows) {
      const diff = Math.abs(parseFloat(row.difference))
      if (diff < 0.01) {
        consistent++
      } else {
        inconsistent++
        console.log(`   ⚠️  ${row.name}: diferencia de ${row.difference}`)
      }
    }

    console.log(`\n   ✅ Consistentes: ${consistent}`)
    if (inconsistent > 0) {
      console.log(`   ⚠️  Inconsistentes: ${inconsistent}`)
    }

    // Resumen final
    console.log('\n' + '═'.repeat(60))
    console.log('📊 RESUMEN')
    console.log('═'.repeat(60))
    console.log(`\n   Entries creados: ${created}`)
    console.log(`   Errores: ${errors}`)
    console.log(`   Cuentas reconciliadas: ${consistent}/${needsEntry.length}`)
    console.log('')

    if (errors === 0 && inconsistent === 0) {
      console.log('✅ Sincronización completada exitosamente!\n')
    } else {
      console.log('⚠️  Sincronización completada con advertencias.\n')
    }

  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
