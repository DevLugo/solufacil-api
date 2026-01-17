/**
 * Script para reconstruir AccountEntry desde Transaction
 *
 * Modos de uso:
 *   npx tsx scripts/rebuild-account-entries.ts --local              # Validar en local (SOURCE=TARGET)
 *   npx tsx scripts/rebuild-account-entries.ts --local --dry-run    # Solo mostrar qué se haría
 *   npx tsx scripts/rebuild-account-entries.ts --prod               # Ejecutar en prod (SOURCE → TARGET)
 *
 * Opciones:
 *   --local              Usa TARGET_DATABASE_URL para ambas (validación local)
 *   --prod               Usa SOURCE_DATABASE_URL → TARGET_DATABASE_URL
 *   --dry-run            Solo muestra qué se haría, no ejecuta cambios
 *   --before-date DATE   Solo migrar transactions antes de esta fecha (default: 2026-01-05)
 *   --force              Continuar aunque ya existan AccountEntry
 *
 * Variables de entorno:
 *   SOURCE_DATABASE_URL  - BD de origen (donde están las Transaction)
 *   TARGET_DATABASE_URL  - BD de destino (donde crear AccountEntry)
 *   TARGET_SCHEMA        - Schema de destino (default: public)
 */

import { Pool } from 'pg'

// Parse arguments
const args = process.argv.slice(2)
const isLocal = args.includes('--local')
const isProd = args.includes('--prod')
const isDryRun = args.includes('--dry-run')
const isForce = args.includes('--force')

// Get before-date argument
const beforeDateIndex = args.indexOf('--before-date')
const BEFORE_DATE = beforeDateIndex !== -1 && args[beforeDateIndex + 1]
  ? args[beforeDateIndex + 1]
  : '2026-01-05T00:00:00.000Z'

// Validate mode
if (!isLocal && !isProd) {
  console.error('❌ Debes especificar un modo: --local o --prod')
  console.error('')
  console.error('Ejemplos:')
  console.error('  npx tsx scripts/rebuild-account-entries.ts --local --dry-run')
  console.error('  npx tsx scripts/rebuild-account-entries.ts --prod')
  process.exit(1)
}

if (isLocal && isProd) {
  console.error('❌ No puedes usar --local y --prod al mismo tiempo')
  process.exit(1)
}

const SOURCE_DATABASE_URL = isLocal
  ? process.env.TARGET_DATABASE_URL!
  : process.env.SOURCE_DATABASE_URL!
const TARGET_DATABASE_URL = process.env.TARGET_DATABASE_URL!
const TARGET_SCHEMA = process.env.TARGET_SCHEMA || 'public'

if (!SOURCE_DATABASE_URL || !TARGET_DATABASE_URL) {
  console.error('❌ Faltan variables de entorno:')
  if (isLocal) {
    console.error('   - TARGET_DATABASE_URL')
  } else {
    console.error('   - SOURCE_DATABASE_URL')
    console.error('   - TARGET_DATABASE_URL')
  }
  process.exit(1)
}

const sourcePool = new Pool({ connectionString: SOURCE_DATABASE_URL })
const targetPool = new Pool({ connectionString: TARGET_DATABASE_URL })

async function run() {
  console.log('═'.repeat(60))
  console.log('📊 Reconstruir AccountEntry desde Transaction')
  console.log('═'.repeat(60))
  console.log('')
  console.log(`🔧 Modo: ${isLocal ? 'LOCAL (validación)' : 'PRODUCCIÓN'}`)
  console.log(`📅 Migrar antes de: ${BEFORE_DATE}`)
  if (isDryRun) console.log('⚠️  DRY-RUN: No se ejecutarán cambios')
  console.log('')
  console.log(`📤 Origen: ${SOURCE_DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`)
  console.log(`📥 Destino: ${TARGET_DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`)
  console.log('')

  const sourceClient = await sourcePool.connect()
  const targetClient = await targetPool.connect()

  try {
    // Verificar conexiones
    await sourceClient.query('SELECT 1')
    await targetClient.query('SELECT 1')
    console.log('✅ Conexión a bases de datos OK\n')

    // Contar registros existentes
    const existingEntries = await targetClient.query(
      `SELECT COUNT(*)::int as count FROM "${TARGET_SCHEMA}"."AccountEntry"`
    )
    const existingCount = existingEntries.rows[0].count

    console.log(`📊 AccountEntry existentes en destino: ${existingCount.toLocaleString()}`)

    if (existingCount > 0 && !isForce && !isDryRun) {
      console.log('')
      console.log('⚠️  Ya existen AccountEntry. Usa --force para continuar.')
      console.log('   Esto podría crear duplicados.')
      process.exit(1)
    }

    // Contar transactions a migrar
    const txCount = await sourceClient.query(`
      SELECT COUNT(*)::int as count
      FROM "Transaction"
      WHERE date < $1
    `, [BEFORE_DATE])
    console.log(`📊 Transactions a migrar (antes de ${BEFORE_DATE}): ${txCount.rows[0].count.toLocaleString()}`)

    // Desglose por tipo
    const breakdown = await sourceClient.query(`
      SELECT
        type,
        COALESCE("incomeSource", "expenseSource", 'NONE') as source,
        COUNT(*)::int as count
      FROM "Transaction"
      WHERE date < $1
      GROUP BY type, COALESCE("incomeSource", "expenseSource", 'NONE')
      ORDER BY type, source
    `, [BEFORE_DATE])

    console.log('\n📋 Desglose por tipo:')
    for (const row of breakdown.rows) {
      console.log(`   ${row.type}.${row.source}: ${row.count.toLocaleString()}`)
    }

    if (isDryRun) {
      console.log('\n⚠️  DRY-RUN: No se ejecutaron cambios.')
      await sourcePool.end()
      await targetPool.end()
      return
    }

    console.log('\n🚀 Iniciando migración...\n')

    // ========================================
    // PASO 1: Transaction local con sourceAccount
    // ========================================
    console.log('📝 PASO 1: Migrando Transaction con sourceAccount...')

    const step1Result = await targetClient.query(`
      INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
        id, "accountId", amount, "entryType", "sourceType",
        "profitAmount", "returnToCapital",
        "snapshotLeadId", "snapshotRouteId",
        "entryDate", description,
        "loanId", "loanPaymentId", "leadPaymentReceivedId", "destinationAccountId",
        "syncId", "createdAt"
      )
      SELECT
        gen_random_uuid()::text,
        t."sourceAccount",
        ABS(t.amount),
        CASE
          WHEN t.type = 'INCOME' THEN 'CREDIT'
          WHEN t.type = 'EXPENSE' AND t.amount < 0 THEN 'CREDIT'
          WHEN t.type = 'EXPENSE' THEN 'DEBIT'
          WHEN t.type = 'TRANSFER' THEN 'DEBIT'
          ELSE 'DEBIT'
        END::"${TARGET_SCHEMA}"."AccountEntryType",
        CASE
          -- Income sources
          WHEN t."incomeSource" = 'CASH_LOAN_PAYMENT' THEN 'LOAN_PAYMENT_CASH'
          WHEN t."incomeSource" = 'BANK_LOAN_PAYMENT' THEN 'LOAN_PAYMENT_BANK'
          WHEN t."incomeSource" = 'LOAN_CANCELLED_RESTORE' THEN 'LOAN_CANCELLED_RESTORE'
          WHEN t."incomeSource" = 'FALCO_COMPENSATORY' THEN 'FALCO_COMPENSATORY'
          WHEN t."incomeSource" = 'INITIAL_BALANCE' THEN 'INITIAL_BALANCE'
          -- Gastos negativos = devoluciones
          WHEN t.type = 'EXPENSE' AND t.amount < 0 THEN 'EXPENSE_REFUND'
          -- Expense sources
          WHEN t."expenseSource" = 'LOAN_GRANTED' THEN 'LOAN_GRANT'
          WHEN t."expenseSource" = 'LOAN_GRANTED_COMISSION' THEN 'LOAN_GRANT_COMMISSION'
          WHEN t."expenseSource" = 'LOAN_PAYMENT_COMISSION' THEN 'PAYMENT_COMMISSION'
          WHEN t."expenseSource" = 'GASOLINE' THEN 'GASOLINE'
          WHEN t."expenseSource" = 'GASOLINE_TOKA' THEN 'GASOLINE_TOKA'
          WHEN t."expenseSource" = 'NOMINA_SALARY' THEN 'NOMINA_SALARY'
          WHEN t."expenseSource" = 'EXTERNAL_SALARY' THEN 'EXTERNAL_SALARY'
          WHEN t."expenseSource" = 'VIATIC' THEN 'VIATIC'
          WHEN t."expenseSource" = 'TRAVEL_EXPENSES' THEN 'TRAVEL_EXPENSES'
          WHEN t."expenseSource" = 'FALCO_LOSS' THEN 'FALCO_LOSS'
          WHEN t."expenseSource" = 'EMPLOYEE_EXPENSE' THEN 'EMPLOYEE_EXPENSE'
          WHEN t."expenseSource" = 'GENERAL_EXPENSE' THEN 'GENERAL_EXPENSE'
          WHEN t."expenseSource" = 'CAR_PAYMENT' THEN 'CAR_PAYMENT'
          WHEN t."expenseSource" = 'BANK_EXPENSE' THEN 'BANK_EXPENSE'
          WHEN t."expenseSource" = 'OTRO' THEN 'OTHER_EXPENSE'
          WHEN t.type = 'TRANSFER' THEN 'TRANSFER_OUT'
          ELSE 'OTHER_EXPENSE'
        END::"${TARGET_SCHEMA}"."SourceType",
        COALESCE(t."profitAmount", 0),
        COALESCE(t."returnToCapital", 0),
        COALESCE(t."snapshotLeadId", ''),
        COALESCE(t."snapshotRouteId", ''),
        t.date,
        COALESCE(t.description, ''),
        t.loan,
        t."loanPayment",
        t."leadPaymentReceived",
        t."destinationAccount",
        gen_random_uuid()::text,
        t."createdAt"
      FROM "${TARGET_SCHEMA}"."Transaction" t
      WHERE t."sourceAccount" IS NOT NULL
        AND t.date < $1
    `, [BEFORE_DATE])
    console.log(`   ✅ ${step1Result.rowCount} entries creados desde Transaction local`)

    // ========================================
    // PASO 2: INCOME sin sourceAccount (de SOURCE DB)
    // ========================================
    console.log('\n📝 PASO 2: Migrando INCOME sin sourceAccount...')

    // Obtener mapeo rutas → cuentas
    const routeAccounts = await targetClient.query(`
      SELECT r.id as route_id, a.id as account_id
      FROM "${TARGET_SCHEMA}"."Route" r
      JOIN "${TARGET_SCHEMA}"."_RouteAccounts" ra ON ra."B" = r.id
      JOIN "${TARGET_SCHEMA}"."Account" a ON a.id = ra."A"
      WHERE a.type = 'EMPLOYEE_CASH_FUND'
    `)
    const routeToAccount = new Map(routeAccounts.rows.map((r: any) => [r.route_id, r.account_id]))
    console.log(`   📋 Mapeo rutas → cuentas: ${routeToAccount.size} rutas`)

    const bankResult = await targetClient.query(
      `SELECT id FROM "${TARGET_SCHEMA}"."Account" WHERE type = 'BANK' LIMIT 1`
    )
    const bankAccountId = bankResult.rows[0]?.id
    console.log(`   🏦 Cuenta banco: ${bankAccountId || 'NO ENCONTRADA'}`)

    // Obtener INCOME sin sourceAccount de la BD origen
    const incomes = await sourceClient.query(`
      SELECT t.id, t.amount, t."profitAmount", t."returnToCapital",
             t."snapshotLeadId", t."snapshotRouteId", t.date, t.description,
             t.loan, t."loanPayment", t."leadPaymentReceived", t."createdAt",
             t."incomeSource", lp."paymentMethod"
      FROM "Transaction" t
      LEFT JOIN "LoanPayment" lp ON lp.id = t."loanPayment"
      WHERE t.type = 'INCOME'
        AND t."sourceAccount" IS NULL
        AND t.date < $1
    `, [BEFORE_DATE])

    let inserted = 0
    let skipped = 0
    const skippedReasons: Record<string, number> = {}

    for (const tx of incomes.rows) {
      // Determinar cuenta
      let accountId: string | undefined
      if (tx.paymentMethod === 'MONEY_TRANSFER') {
        accountId = bankAccountId
      } else {
        accountId = routeToAccount.get(tx.snapshotRouteId)
      }

      if (!accountId) {
        skipped++
        const reason = tx.snapshotRouteId
          ? `Route ${tx.snapshotRouteId} sin cuenta`
          : 'snapshotRouteId vacío'
        skippedReasons[reason] = (skippedReasons[reason] || 0) + 1
        continue
      }

      // Determinar sourceType y profit
      let sourceType: string
      let profit: number
      let returnCap: number

      if (tx.incomeSource === 'MONEY_INVESMENT') {
        sourceType = 'MONEY_INVESTMENT'
        profit = 0
        returnCap = 0
      } else if (tx.incomeSource === 'MULTA') {
        sourceType = 'MULTA'
        profit = Math.abs(tx.amount)
        returnCap = 0
      } else if (tx.paymentMethod === 'MONEY_TRANSFER') {
        sourceType = 'LOAN_PAYMENT_BANK'
        profit = tx.profitAmount || 0
        returnCap = tx.returnToCapital || 0
      } else {
        sourceType = 'LOAN_PAYMENT_CASH'
        profit = tx.profitAmount || 0
        returnCap = tx.returnToCapital || 0
      }

      try {
        await targetClient.query(`
          INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
            id, "accountId", amount, "entryType", "sourceType",
            "profitAmount", "returnToCapital",
            "snapshotLeadId", "snapshotRouteId", "entryDate", description,
            "loanId", "loanPaymentId", "leadPaymentReceivedId", "syncId", "createdAt"
          ) VALUES (
            gen_random_uuid()::text, $1, $2,
            'CREDIT'::"${TARGET_SCHEMA}"."AccountEntryType",
            $3::"${TARGET_SCHEMA}"."SourceType",
            $4, $5, COALESCE($6,''), COALESCE($7,''), $8, COALESCE($9,''),
            $10, $11, $12, gen_random_uuid()::text, $13
          )
        `, [
          accountId,
          Math.abs(tx.amount),
          sourceType,
          profit,
          returnCap,
          tx.snapshotLeadId,
          tx.snapshotRouteId,
          tx.date,
          tx.description,
          tx.loan,
          tx.loanPayment,
          tx.leadPaymentReceived,
          tx.createdAt,
        ])
        inserted++
      } catch (err: any) {
        skipped++
        skippedReasons[err.message?.slice(0, 50) || 'Error desconocido'] =
          (skippedReasons[err.message?.slice(0, 50) || 'Error desconocido'] || 0) + 1
      }
    }

    console.log(`   ✅ ${inserted} entries INCOME creados`)
    if (skipped > 0) {
      console.log(`   ⚠️  ${skipped} omitidos:`)
      for (const [reason, count] of Object.entries(skippedReasons)) {
        console.log(`      - ${reason}: ${count}`)
      }
    }

    // ========================================
    // PASO 3: TRANSFER_IN (lado destino)
    // ========================================
    console.log('\n📝 PASO 3: Creando TRANSFER_IN...')

    const transferResult = await targetClient.query(`
      INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
        id, "accountId", amount, "entryType", "sourceType",
        "profitAmount", "returnToCapital", "snapshotLeadId", "snapshotRouteId",
        "entryDate", description, "loanId", "loanPaymentId", "leadPaymentReceivedId",
        "destinationAccountId", "syncId", "createdAt"
      )
      SELECT
        gen_random_uuid()::text,
        t."destinationAccount",
        ABS(t.amount),
        'CREDIT'::"${TARGET_SCHEMA}"."AccountEntryType",
        'TRANSFER_IN'::"${TARGET_SCHEMA}"."SourceType",
        0, 0, '', '',
        t.date,
        COALESCE(t.description,''),
        NULL, NULL, NULL,
        t."sourceAccount",
        gen_random_uuid()::text,
        t."createdAt"
      FROM "${TARGET_SCHEMA}"."Transaction" t
      WHERE t.type = 'TRANSFER'
        AND t."destinationAccount" IS NOT NULL
        AND t.date < $1
    `, [BEFORE_DATE])
    console.log(`   ✅ ${transferResult.rowCount} entries TRANSFER_IN creados`)

    // ========================================
    // PASO 4: Reconciliación de balances
    // ========================================
    console.log('\n📝 PASO 4: Reconciliando balances...')

    const accounts = await targetClient.query(
      `SELECT id, name, amount FROM "${TARGET_SCHEMA}"."Account"`
    )

    let adjustments = 0
    const adjustmentDetails: string[] = []

    for (const acct of accounts.rows) {
      const sumResult = await targetClient.query(`
        SELECT COALESCE(SUM(
          CASE WHEN "entryType"='CREDIT' THEN amount ELSE -amount END
        ), 0)::numeric as calc
        FROM "${TARGET_SCHEMA}"."AccountEntry"
        WHERE "accountId" = $1
      `, [acct.id])

      const diff = parseFloat(acct.amount) - parseFloat(sumResult.rows[0].calc)

      if (Math.abs(diff) > 0.01) {
        const entryType = diff > 0 ? 'CREDIT' : 'DEBIT'
        await targetClient.query(`
          INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
            id, "accountId", amount, "entryType", "sourceType",
            "profitAmount", "returnToCapital", "snapshotLeadId", "snapshotRouteId",
            "entryDate", description, "syncId", "createdAt"
          ) VALUES (
            gen_random_uuid()::text, $1, $2, $3::"${TARGET_SCHEMA}"."AccountEntryType",
            'BALANCE_ADJUSTMENT'::"${TARGET_SCHEMA}"."SourceType",
            0, 0, '', '', NOW(), 'Ajuste de reconciliación', gen_random_uuid()::text, NOW()
          )
        `, [acct.id, Math.abs(diff), entryType])

        adjustments++
        adjustmentDetails.push(`${acct.name}: ${diff > 0 ? '+' : ''}${diff.toFixed(2)}`)
      }
    }

    console.log(`   ✅ ${adjustments} ajustes de balance creados`)
    if (adjustmentDetails.length > 0 && adjustmentDetails.length <= 10) {
      for (const detail of adjustmentDetails) {
        console.log(`      - ${detail}`)
      }
    }

    // ========================================
    // PASO 5: Verificación final de balances
    // ========================================
    console.log('\n📝 PASO 5: Verificación final de balances...')

    const verification = await targetClient.query(`
      SELECT
        a.id,
        a.name,
        a.type,
        a.amount::numeric as stored_balance,
        COALESCE(SUM(
          CASE WHEN ae."entryType" = 'CREDIT' THEN ae.amount::numeric
               ELSE -ae.amount::numeric END
        ), 0) as calculated_balance,
        a.amount::numeric - COALESCE(SUM(
          CASE WHEN ae."entryType" = 'CREDIT' THEN ae.amount::numeric
               ELSE -ae.amount::numeric END
        ), 0) as difference
      FROM "${TARGET_SCHEMA}"."Account" a
      LEFT JOIN "${TARGET_SCHEMA}"."AccountEntry" ae ON ae."accountId" = a.id
      GROUP BY a.id, a.name, a.type, a.amount
      HAVING ABS(a.amount::numeric - COALESCE(SUM(
        CASE WHEN ae."entryType" = 'CREDIT' THEN ae.amount::numeric
             ELSE -ae.amount::numeric END
      ), 0)) > 0.01
      ORDER BY ABS(a.amount::numeric - COALESCE(SUM(
        CASE WHEN ae."entryType" = 'CREDIT' THEN ae.amount::numeric
             ELSE -ae.amount::numeric END
      ), 0)) DESC
    `)

    if (verification.rows.length === 0) {
      console.log('   ✅ TODOS los balances coinciden exactamente')
    } else {
      console.log(`   ❌ ${verification.rows.length} cuentas con diferencias:`)
      for (const row of verification.rows.slice(0, 10)) {
        console.log(`      - ${row.name}: stored=${parseFloat(row.stored_balance).toFixed(2)}, calculated=${parseFloat(row.calculated_balance).toFixed(2)}, diff=${parseFloat(row.difference).toFixed(2)}`)
      }
      if (verification.rows.length > 10) {
        console.log(`      ... y ${verification.rows.length - 10} más`)
      }
    }

    // ========================================
    // RESUMEN FINAL
    // ========================================
    console.log('\n' + '═'.repeat(60))
    console.log('📊 RESUMEN FINAL')
    console.log('═'.repeat(60))

    const summary = await targetClient.query(`
      SELECT "sourceType", "entryType", COUNT(*)::int as count, SUM(amount)::numeric(18,2) as total
      FROM "${TARGET_SCHEMA}"."AccountEntry"
      GROUP BY 1, 2
      ORDER BY 1, 2
    `)

    console.log('\n📋 AccountEntry por tipo:')
    for (const row of summary.rows) {
      console.log(`   ${row.sourceType} (${row.entryType}): ${row.count.toLocaleString()} entries, $${parseFloat(row.total).toLocaleString()}`)
    }

    const finalCount = await targetClient.query(
      `SELECT COUNT(*)::int as count FROM "${TARGET_SCHEMA}"."AccountEntry"`
    )
    console.log(`\n📊 Total AccountEntry: ${finalCount.rows[0].count.toLocaleString()}`)

    // Resumen de verificación
    const totalAccounts = await targetClient.query(
      `SELECT COUNT(*)::int as count FROM "${TARGET_SCHEMA}"."Account"`
    )
    const consistentAccounts = totalAccounts.rows[0].count - verification.rows.length

    console.log(`\n📊 Verificación de balances:`)
    console.log(`   ✅ Cuentas consistentes: ${consistentAccounts}/${totalAccounts.rows[0].count}`)

    if (verification.rows.length > 0) {
      console.log(`   ❌ Cuentas con diferencias: ${verification.rows.length}`)
      console.log('\n⚠️  ADVERTENCIA: Hay cuentas con balances inconsistentes.')
      console.log('   Revisa los ajustes de reconciliación.\n')
    } else {
      console.log('\n✅ ¡Migración completada exitosamente!')
      console.log('   SUM(AccountEntry) = Account.amount para TODAS las cuentas.\n')
    }

  } finally {
    sourceClient.release()
    targetClient.release()
    await sourcePool.end()
    await targetPool.end()
  }
}

run().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
