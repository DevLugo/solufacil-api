/**
 * Script para actualizar snapshotLeadId en AccountEntry existentes
 * Usa el campo "lead" de Transaction como fallback cuando snapshotLeadId está vacío
 *
 * Uso:
 *   npx tsx scripts/fix-snapshot-lead-id.ts
 */

import 'dotenv/config'
import { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL no está definida')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL })

async function main() {
  console.log('═'.repeat(60))
  console.log('🔧 Fix: Actualizar snapshotLeadId en AccountEntry')
  console.log('═'.repeat(60))
  console.log('')

  const client = await pool.connect()

  try {
    // Contar registros afectados
    const countResult = await client.query(`
      SELECT COUNT(*) as count
      FROM "AccountEntry" ae
      WHERE (ae."snapshotLeadId" IS NULL OR ae."snapshotLeadId" = '')
    `)
    console.log(`📊 AccountEntry sin snapshotLeadId: ${countResult.rows[0].count}`)

    // Contar cuántos podemos arreglar vía loanId
    const fixableViaLoan = await client.query(`
      SELECT COUNT(*) as count
      FROM "AccountEntry" ae
      JOIN "Loan" l ON ae."loanId" = l.id
      WHERE (ae."snapshotLeadId" IS NULL OR ae."snapshotLeadId" = '')
        AND l.lead IS NOT NULL AND l.lead != ''
    `)
    console.log(`📊 Arreglables vía Loan.lead: ${fixableViaLoan.rows[0].count}`)

    // Contar cuántos podemos arreglar vía loanPaymentId
    const fixableViaPayment = await client.query(`
      SELECT COUNT(*) as count
      FROM "AccountEntry" ae
      JOIN "LoanPayment" lp ON ae."loanPaymentId" = lp.id
      JOIN "Loan" l ON lp.loan = l.id
      WHERE (ae."snapshotLeadId" IS NULL OR ae."snapshotLeadId" = '')
        AND l.lead IS NOT NULL AND l.lead != ''
        AND ae."loanId" IS NULL
    `)
    console.log(`📊 Arreglables vía LoanPayment→Loan.lead: ${fixableViaPayment.rows[0].count}`)

    // Diagnóstico: qué tipos de entries sin snapshotLeadId tenemos?
    const bySourceType = await client.query(`
      SELECT ae."sourceType", COUNT(*) as count
      FROM "AccountEntry" ae
      WHERE (ae."snapshotLeadId" IS NULL OR ae."snapshotLeadId" = '')
      GROUP BY ae."sourceType"
      ORDER BY count DESC
      LIMIT 10
    `)
    console.log('\n📊 Entries sin snapshotLeadId por sourceType:')
    for (const row of bySourceType.rows) {
      console.log(`   ${row.sourceType}: ${row.count}`)
    }

    // Diagnóstico: Verificar si hay Transactions con lead que no matchean
    const transactionsWithLead = await client.query(`
      SELECT COUNT(*) as count
      FROM "Transaction" t
      WHERE t.lead IS NOT NULL AND t.lead != ''
    `)
    console.log(`\n📊 Transactions con lead: ${transactionsWithLead.rows[0].count}`)

    // Probar matching más flexible (solo fecha y cuenta, ignorando monto exacto)
    const fixableViaTransactionFlexible = await client.query(`
      SELECT COUNT(*) as count
      FROM "AccountEntry" ae
      WHERE (ae."snapshotLeadId" IS NULL OR ae."snapshotLeadId" = '')
        AND EXISTS (
          SELECT 1 FROM "Transaction" t
          WHERE t."sourceAccount" = ae."accountId"
            AND DATE(t.date) = DATE(ae."entryDate")
            AND t.lead IS NOT NULL AND t.lead != ''
        )
    `)
    console.log(`📊 Arreglables vía Transaction (fecha+cuenta): ${fixableViaTransactionFlexible.rows[0].count}`)

    // Contar cuántos podemos arreglar vía Transaction.lead (matching por fecha, monto, cuenta)
    const fixableViaTransaction = await client.query(`
      SELECT COUNT(*) as count
      FROM "AccountEntry" ae
      WHERE (ae."snapshotLeadId" IS NULL OR ae."snapshotLeadId" = '')
        AND EXISTS (
          SELECT 1 FROM "Transaction" t
          WHERE t."sourceAccount" = ae."accountId"
            AND t.date = ae."entryDate"
            AND t.amount = ae.amount
            AND t.lead IS NOT NULL AND t.lead != ''
        )
    `)
    console.log(`📊 Arreglables vía Transaction (fecha+cuenta+monto exacto): ${fixableViaTransaction.rows[0].count}`)

    console.log('\n🚀 Ejecutando actualizaciones...\n')

    await client.query('BEGIN')

    // 1. Actualizar vía Loan.lead (para entries con loanId)
    console.log('1️⃣  Actualizando vía Loan.lead...')
    const update1 = await client.query(`
      UPDATE "AccountEntry" ae
      SET "snapshotLeadId" = l.lead
      FROM "Loan" l
      WHERE ae."loanId" = l.id
        AND (ae."snapshotLeadId" IS NULL OR ae."snapshotLeadId" = '')
        AND l.lead IS NOT NULL AND l.lead != ''
    `)
    console.log(`   ✅ ${update1.rowCount} registros actualizados`)

    // 2. Actualizar vía LoanPayment→Loan.lead (para entries con loanPaymentId pero sin loanId)
    console.log('2️⃣  Actualizando vía LoanPayment→Loan.lead...')
    const update2 = await client.query(`
      UPDATE "AccountEntry" ae
      SET "snapshotLeadId" = l.lead
      FROM "LoanPayment" lp
      JOIN "Loan" l ON lp.loan = l.id
      WHERE ae."loanPaymentId" = lp.id
        AND (ae."snapshotLeadId" IS NULL OR ae."snapshotLeadId" = '')
        AND l.lead IS NOT NULL AND l.lead != ''
    `)
    console.log(`   ✅ ${update2.rowCount} registros actualizados`)

    // 3. Actualizar vía Transaction.lead (matching por fecha, monto, cuenta)
    console.log('3️⃣  Actualizando vía Transaction.lead...')
    const update3 = await client.query(`
      UPDATE "AccountEntry" ae
      SET "snapshotLeadId" = (
        SELECT t.lead FROM "Transaction" t
        WHERE t."sourceAccount" = ae."accountId"
          AND t.date = ae."entryDate"
          AND t.amount = ae.amount
          AND t.lead IS NOT NULL AND t.lead != ''
        LIMIT 1
      )
      WHERE (ae."snapshotLeadId" IS NULL OR ae."snapshotLeadId" = '')
        AND EXISTS (
          SELECT 1 FROM "Transaction" t
          WHERE t."sourceAccount" = ae."accountId"
            AND t.date = ae."entryDate"
            AND t.amount = ae.amount
            AND t.lead IS NOT NULL AND t.lead != ''
        )
    `)
    console.log(`   ✅ ${update3.rowCount} registros actualizados`)

    await client.query('COMMIT')

    // Verificación final
    const finalCount = await client.query(`
      SELECT COUNT(*) as count
      FROM "AccountEntry" ae
      WHERE (ae."snapshotLeadId" IS NULL OR ae."snapshotLeadId" = '')
    `)
    console.log(`\n📊 AccountEntry sin snapshotLeadId después del fix: ${finalCount.rows[0].count}`)

    const totalUpdated = (update1.rowCount || 0) + (update2.rowCount || 0) + (update3.rowCount || 0)
    console.log(`\n✅ Total actualizados: ${totalUpdated}`)

  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
