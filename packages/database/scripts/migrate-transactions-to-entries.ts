/**
 * Script para migrar Transaction → AccountEntry
 *
 * Este script:
 * 1. Migra TODOS los registros de Transaction a AccountEntry (para mantener historial)
 * 2. Agrega entries BALANCE_ADJUSTMENT para corregir cualquier diferencia
 *
 * Uso:
 *   npx tsx scripts/migrate-transactions-to-entries.ts           # Ejecutar
 *   npx tsx scripts/migrate-transactions-to-entries.ts --dry-run # Solo mostrar qué se haría
 *   npx tsx scripts/migrate-transactions-to-entries.ts --count   # Solo contar registros
 *
 * Variables de entorno:
 *   DATABASE_URL - URL de la base de datos
 */

import 'dotenv/config'
import { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL
const DRY_RUN = process.argv.includes('--dry-run')
const COUNT_ONLY = process.argv.includes('--count')

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL no está definida')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL })

// Mapeo de Transaction.incomeSource/expenseSource → AccountEntry.sourceType
const SOURCE_TYPE_MAP: Record<string, string> = {
  // Income sources → Credit entries
  'CASH_LOAN_PAYMENT': 'LOAN_PAYMENT_CASH',
  'BANK_LOAN_PAYMENT': 'LOAN_PAYMENT_BANK',
  'FALCO_COMPENSATORY': 'FALCO_COMPENSATORY',

  // Expense sources → Debit entries
  'LOAN_GRANTED': 'LOAN_GRANT',
  'LOAN_GRANTED_COMISSION': 'LOAN_GRANT_COMMISSION',
  'LOAN_PAYMENT_COMISSION': 'PAYMENT_COMMISSION',
  'GASOLINE': 'GASOLINE',
  'GASOLINE_TOKA': 'GASOLINE_TOKA',
  'NOMINA_SALARY': 'NOMINA_SALARY',
  'EXTERNAL_SALARY': 'EXTERNAL_SALARY',
  'VIATIC': 'VIATIC',
  'TRAVEL_EXPENSES': 'TRAVEL_EXPENSES',
  'FALCO_LOSS': 'FALCO_LOSS',
  'TRANSFER': 'TRANSFER_OUT', // For transfers, the source account gets DEBIT

  // Default
  'DEFAULT': 'BALANCE_ADJUSTMENT',
}

async function main() {
  console.log('═'.repeat(60))
  console.log('📊 Migración: Transaction → AccountEntry')
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

    // Verificar que las tablas existen
    const tablesExist = await client.query(`
      SELECT
        (SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'Transaction')) as has_transaction,
        (SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'AccountEntry')) as has_entry
    `)

    if (!tablesExist.rows[0].has_transaction) {
      console.error('❌ La tabla Transaction no existe.')
      process.exit(1)
    }

    if (!tablesExist.rows[0].has_entry) {
      console.error('❌ La tabla AccountEntry no existe. Ejecuta la migración de schema primero.')
      process.exit(1)
    }

    // Contar registros
    const transactionCount = await client.query('SELECT COUNT(*)::int as count FROM "Transaction"')
    const existingEntriesCount = await client.query('SELECT COUNT(*)::int as count FROM "AccountEntry"')
    const accountCount = await client.query('SELECT COUNT(*)::int as count FROM "Account"')

    console.log('📊 Estadísticas actuales:')
    console.log(`   • Transactions: ${transactionCount.rows[0].count.toLocaleString()}`)
    console.log(`   • AccountEntry existentes: ${existingEntriesCount.rows[0].count.toLocaleString()}`)
    console.log(`   • Cuentas: ${accountCount.rows[0].count.toLocaleString()}`)
    console.log('')

    if (COUNT_ONLY) {
      // Mostrar desglose por tipo
      const breakdown = await client.query(`
        SELECT
          type,
          COALESCE("incomeSource", "expenseSource", 'NONE') as source,
          COUNT(*)::int as count
        FROM "Transaction"
        GROUP BY type, COALESCE("incomeSource", "expenseSource", 'NONE')
        ORDER BY type, source
      `)

      console.log('📋 Desglose por tipo:')
      for (const row of breakdown.rows) {
        console.log(`   ${row.type}.${row.source}: ${row.count.toLocaleString()}`)
      }

      await pool.end()
      return
    }

    if (existingEntriesCount.rows[0].count > 0) {
      console.log('⚠️  Ya existen AccountEntry. La migración podría crear duplicados.')
      console.log('   Si quieres volver a migrar, elimina los AccountEntry existentes primero.\n')

      if (!process.argv.includes('--force')) {
        console.log('   Usa --force para continuar de todas formas.\n')
        await pool.end()
        return
      }
    }

    if (DRY_RUN) {
      console.log('⚠️  Modo DRY-RUN: No se ejecutaron cambios.\n')
      await pool.end()
      return
    }

    // ============================
    // PASO 1: Migrar Transactions
    // ============================
    console.log('📝 PASO 1: Migrando Transaction → AccountEntry...\n')

    await client.query('BEGIN')

    try {
      // 1a. Migrar INCOME transactions (CREDIT entries)
      console.log('   Migrando INCOME transactions...')
      const incomeResult = await client.query(`
        INSERT INTO "AccountEntry" (
          id,
          "accountId",
          amount,
          "entryType",
          "sourceType",
          "profitAmount",
          "returnToCapital",
          "snapshotLeadId",
          "snapshotRouteId",
          "entryDate",
          description,
          "loanId",
          "loanPaymentId",
          "leadPaymentReceivedId",
          "destinationAccountId",
          "createdAt",
          "syncId"
        )
        SELECT
          gen_random_uuid(),
          COALESCE("sourceAccount", "destinationAccount"),
          amount,
          'CREDIT'::"AccountEntryType",
          CASE
            WHEN "incomeSource" = 'CASH_LOAN_PAYMENT' THEN 'LOAN_PAYMENT_CASH'
            WHEN "incomeSource" = 'BANK_LOAN_PAYMENT' THEN 'LOAN_PAYMENT_BANK'
            WHEN "incomeSource" = 'FALCO_COMPENSATORY' THEN 'FALCO_COMPENSATORY'
            WHEN "incomeSource" = 'LOAN_CANCELLED_RESTORE' THEN 'LOAN_CANCELLED_RESTORE'
            ELSE 'BALANCE_ADJUSTMENT'
          END::"SourceType",
          COALESCE("profitAmount", 0),
          COALESCE("returnToCapital", 0),
          COALESCE("snapshotLeadId", ''),
          COALESCE("snapshotRouteId", ''),
          date,
          COALESCE(description, ''),
          loan,
          "loanPayment",
          "leadPaymentReceived",
          NULL,
          "createdAt",
          gen_random_uuid()
        FROM "Transaction"
        WHERE type = 'INCOME'
          AND (COALESCE("sourceAccount", "destinationAccount")) IS NOT NULL
      `)
      console.log(`   ✅ ${incomeResult.rowCount} INCOME entries creados`)

      // 1b. Migrar EXPENSE transactions (DEBIT entries)
      console.log('   Migrando EXPENSE transactions...')
      const expenseResult = await client.query(`
        INSERT INTO "AccountEntry" (
          id,
          "accountId",
          amount,
          "entryType",
          "sourceType",
          "profitAmount",
          "returnToCapital",
          "snapshotLeadId",
          "snapshotRouteId",
          "entryDate",
          description,
          "loanId",
          "loanPaymentId",
          "leadPaymentReceivedId",
          "destinationAccountId",
          "createdAt",
          "syncId"
        )
        SELECT
          gen_random_uuid(),
          "sourceAccount",
          amount,
          'DEBIT'::"AccountEntryType",
          CASE
            WHEN "expenseSource" = 'LOAN_GRANTED' THEN 'LOAN_GRANT'
            WHEN "expenseSource" = 'LOAN_GRANTED_COMISSION' THEN 'LOAN_GRANT_COMMISSION'
            WHEN "expenseSource" = 'LOAN_PAYMENT_COMISSION' THEN 'PAYMENT_COMMISSION'
            WHEN "expenseSource" = 'GASOLINE' THEN 'GASOLINE'
            WHEN "expenseSource" = 'GASOLINE_TOKA' THEN 'GASOLINE_TOKA'
            WHEN "expenseSource" = 'NOMINA_SALARY' THEN 'NOMINA_SALARY'
            WHEN "expenseSource" = 'EXTERNAL_SALARY' THEN 'EXTERNAL_SALARY'
            WHEN "expenseSource" = 'VIATIC' THEN 'VIATIC'
            WHEN "expenseSource" = 'TRAVEL_EXPENSES' THEN 'TRAVEL_EXPENSES'
            WHEN "expenseSource" = 'FALCO_LOSS' THEN 'FALCO_LOSS'
            ELSE 'BALANCE_ADJUSTMENT'
          END::"SourceType",
          0,
          0,
          COALESCE("snapshotLeadId", ''),
          COALESCE("snapshotRouteId", ''),
          date,
          COALESCE(description, ''),
          loan,
          "loanPayment",
          "leadPaymentReceived",
          "destinationAccount",
          "createdAt",
          gen_random_uuid()
        FROM "Transaction"
        WHERE type = 'EXPENSE'
          AND "sourceAccount" IS NOT NULL
      `)
      console.log(`   ✅ ${expenseResult.rowCount} EXPENSE entries creados`)

      // 1c. Migrar TRANSFER transactions (2 entries: DEBIT source, CREDIT destination)
      console.log('   Migrando TRANSFER transactions (source DEBIT)...')
      const transferOutResult = await client.query(`
        INSERT INTO "AccountEntry" (
          id,
          "accountId",
          amount,
          "entryType",
          "sourceType",
          "profitAmount",
          "returnToCapital",
          "snapshotLeadId",
          "snapshotRouteId",
          "entryDate",
          description,
          "loanId",
          "loanPaymentId",
          "leadPaymentReceivedId",
          "destinationAccountId",
          "createdAt",
          "syncId"
        )
        SELECT
          gen_random_uuid(),
          "sourceAccount",
          amount,
          'DEBIT'::"AccountEntryType",
          'TRANSFER_OUT'::"SourceType",
          0,
          0,
          COALESCE("snapshotLeadId", ''),
          COALESCE("snapshotRouteId", ''),
          date,
          COALESCE(description, ''),
          loan,
          "loanPayment",
          "leadPaymentReceived",
          "destinationAccount",
          "createdAt",
          gen_random_uuid()
        FROM "Transaction"
        WHERE type = 'TRANSFER'
          AND "sourceAccount" IS NOT NULL
      `)
      console.log(`   ✅ ${transferOutResult.rowCount} TRANSFER_OUT entries creados`)

      console.log('   Migrando TRANSFER transactions (destination CREDIT)...')
      const transferInResult = await client.query(`
        INSERT INTO "AccountEntry" (
          id,
          "accountId",
          amount,
          "entryType",
          "sourceType",
          "profitAmount",
          "returnToCapital",
          "snapshotLeadId",
          "snapshotRouteId",
          "entryDate",
          description,
          "loanId",
          "loanPaymentId",
          "leadPaymentReceivedId",
          "destinationAccountId",
          "createdAt",
          "syncId"
        )
        SELECT
          gen_random_uuid(),
          "destinationAccount",
          amount,
          'CREDIT'::"AccountEntryType",
          'TRANSFER_IN'::"SourceType",
          0,
          0,
          COALESCE("snapshotLeadId", ''),
          COALESCE("snapshotRouteId", ''),
          date,
          COALESCE(description, ''),
          loan,
          "loanPayment",
          "leadPaymentReceived",
          "sourceAccount",
          "createdAt",
          gen_random_uuid()
        FROM "Transaction"
        WHERE type = 'TRANSFER'
          AND "destinationAccount" IS NOT NULL
      `)
      console.log(`   ✅ ${transferInResult.rowCount} TRANSFER_IN entries creados`)

      const totalMigrated =
        (incomeResult.rowCount || 0) +
        (expenseResult.rowCount || 0) +
        (transferOutResult.rowCount || 0) +
        (transferInResult.rowCount || 0)

      console.log(`\n   📊 Total entries migrados: ${totalMigrated.toLocaleString()}`)

      // ============================
      // PASO 2: Ajustar diferencias
      // ============================
      console.log('\n📝 PASO 2: Verificando y ajustando balances...\n')

      // Calcular diferencia para cada cuenta
      const discrepancies = await client.query(`
        SELECT
          a.id,
          a.name,
          a.type,
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
        ORDER BY ABS(a.amount::numeric - COALESCE(
          (SELECT SUM(
            CASE WHEN ae."entryType" = 'CREDIT' THEN ae.amount::numeric
                 ELSE -ae.amount::numeric END
          ) FROM "AccountEntry" ae WHERE ae."accountId" = a.id),
          0
        )) DESC
      `)

      let adjustmentCount = 0
      let consistentCount = 0

      for (const row of discrepancies.rows) {
        const diff = parseFloat(row.difference)
        if (Math.abs(diff) < 0.01) {
          consistentCount++
          continue
        }

        // Necesita ajuste
        const entryType = diff > 0 ? 'CREDIT' : 'DEBIT'
        const amount = Math.abs(diff)

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
            'BALANCE_ADJUSTMENT'::"SourceType",
            'Ajuste por migración - diferencia con balance histórico',
            NOW(),
            NOW(),
            gen_random_uuid()
          )
        `, [row.id, amount, entryType])

        adjustmentCount++
        console.log(`   ⚠️  ${row.name} (${row.type}): ajuste de ${diff > 0 ? '+' : ''}${diff.toFixed(2)}`)
      }

      console.log(`\n   📊 Cuentas consistentes: ${consistentCount}`)
      console.log(`   📊 Cuentas con ajuste: ${adjustmentCount}`)

      await client.query('COMMIT')

      // ============================
      // VERIFICACIÓN FINAL
      // ============================
      console.log('\n📝 PASO 3: Verificación final...\n')

      const finalCheck = await client.query(`
        SELECT
          COUNT(*) FILTER (WHERE ABS(stored_balance - calculated_balance) < 0.01) as consistent,
          COUNT(*) FILTER (WHERE ABS(stored_balance - calculated_balance) >= 0.01) as inconsistent
        FROM (
          SELECT
            a.id,
            a.amount::numeric as stored_balance,
            COALESCE(
              (SELECT SUM(
                CASE WHEN ae."entryType" = 'CREDIT' THEN ae.amount::numeric
                     ELSE -ae.amount::numeric END
              ) FROM "AccountEntry" ae WHERE ae."accountId" = a.id),
              0
            ) as calculated_balance
          FROM "Account" a
        ) subq
      `)

      const totalEntries = await client.query('SELECT COUNT(*)::int as count FROM "AccountEntry"')

      console.log('═'.repeat(60))
      console.log('📊 RESUMEN FINAL')
      console.log('═'.repeat(60))
      console.log(`\n   Total AccountEntry: ${totalEntries.rows[0].count.toLocaleString()}`)
      console.log(`   Cuentas consistentes: ${finalCheck.rows[0].consistent}`)
      console.log(`   Cuentas inconsistentes: ${finalCheck.rows[0].inconsistent}`)

      if (parseInt(finalCheck.rows[0].inconsistent) === 0) {
        console.log('\n✅ Migración completada exitosamente!')
        console.log('   SUM(AccountEntry) = Account.amount para todas las cuentas.\n')
      } else {
        console.log('\n⚠️  Migración completada con advertencias.')
        console.log('   Algunas cuentas aún tienen discrepancias.\n')
      }

    } catch (err) {
      await client.query('ROLLBACK')
      throw err
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
