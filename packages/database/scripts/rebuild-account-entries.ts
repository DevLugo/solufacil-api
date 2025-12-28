import { Pool } from 'pg'

const SOURCE_DATABASE_URL = process.env.SOURCE_DATABASE_URL!
const TARGET_DATABASE_URL = process.env.TARGET_DATABASE_URL!
const TARGET_SCHEMA = process.env.TARGET_SCHEMA || 'public'

const sourcePool = new Pool({ connectionString: SOURCE_DATABASE_URL })
const targetPool = new Pool({ connectionString: TARGET_DATABASE_URL })

async function run() {
  console.log('📊 Reconstruyendo AccountEntry...\n')
  const client = await targetPool.connect()

  try {
    // Paso 1: Convertir transacciones con sourceAccount
    // IMPORTANTE: Gastos negativos (devoluciones) se convierten a CREDIT con EXPENSE_REFUND
    const result = await client.query(`
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
          -- Gastos negativos son devoluciones = CREDIT
          WHEN t.type = 'EXPENSE' AND t.amount < 0 THEN 'CREDIT'
          WHEN t.type = 'EXPENSE' THEN 'DEBIT'
          WHEN t.type = 'TRANSFER' THEN 'DEBIT'
          ELSE 'DEBIT'
        END::"${TARGET_SCHEMA}"."AccountEntryType",
        CASE
          -- Income sources
          WHEN t."incomeSource" = 'CASH_LOAN_PAYMENT' THEN 'LOAN_PAYMENT_CASH'
          WHEN t."incomeSource" = 'BANK_LOAN_PAYMENT' THEN 'LOAN_PAYMENT_BANK'
          -- Gastos negativos = devoluciones
          WHEN t.type = 'EXPENSE' AND t.amount < 0 THEN 'EXPENSE_REFUND'
          -- Expense sources con mapping específico
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
          -- Otros gastos operativos
          WHEN t."expenseSource" = 'EMPLOYEE_EXPENSE' THEN 'EMPLOYEE_EXPENSE'
          WHEN t."expenseSource" = 'GENERAL_EXPENSE' THEN 'GENERAL_EXPENSE'
          WHEN t."expenseSource" = 'CAR_PAYMENT' THEN 'CAR_PAYMENT'
          WHEN t."expenseSource" = 'BANK_EXPENSE' THEN 'BANK_EXPENSE'
          WHEN t."expenseSource" = 'OTRO' THEN 'OTHER_EXPENSE'
          -- Transfer
          WHEN t.type = 'TRANSFER' THEN 'TRANSFER_OUT'
          -- Default
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
    `)
    console.log(`   ✅ ${result.rowCount} entries creados desde Transaction local`)

    // Paso 2: Convertir INCOME de producción
    console.log('📊 Creando entries desde INCOME de producción...')
    const sourceClient = await sourcePool.connect()

    // Obtener mapeo rutas → cuentas
    const routeAccounts = await client.query(`
      SELECT r.id as route_id, a.id as account_id
      FROM "${TARGET_SCHEMA}"."Route" r
      JOIN "${TARGET_SCHEMA}"."_RouteAccounts" ra ON ra."B" = r.id
      JOIN "${TARGET_SCHEMA}"."Account" a ON a.id = ra."A"
      WHERE a.type = 'EMPLOYEE_CASH_FUND'
    `)
    const routeToAccount = new Map(routeAccounts.rows.map((r: any) => [r.route_id, r.account_id]))

    const bankResult = await client.query(
      `SELECT id FROM "${TARGET_SCHEMA}"."Account" WHERE type = 'BANK' LIMIT 1`
    )
    const bankAccountId = bankResult.rows[0]?.id

    const incomes = await sourceClient.query(`
      SELECT t.id, t.amount, t."profitAmount", t."returnToCapital",
             t."snapshotLeadId", t."snapshotRouteId", t.date, t.description,
             t.loan, t."loanPayment", t."leadPaymentReceived", t."createdAt",
             t."incomeSource", lp."paymentMethod"
      FROM "Transaction" t
      LEFT JOIN "LoanPayment" lp ON lp.id = t."loanPayment"
      WHERE t.type = 'INCOME' AND t."sourceAccount" IS NULL
    `)

    let inserted = 0,
      skipped = 0
    for (const tx of incomes.rows) {
      let accountId =
        tx.paymentMethod === 'MONEY_TRANSFER' ? bankAccountId : routeToAccount.get(tx.snapshotRouteId)
      if (!accountId) {
        skipped++
        continue
      }

      let sourceType: string
      let profit: number
      let returnCap: number

      if (tx.incomeSource === 'MONEY_INVESMENT') {
        sourceType = 'MONEY_INVESTMENT'
        profit = 0 // Inversión no es ganancia
        returnCap = 0
      } else if (tx.incomeSource === 'MULTA') {
        sourceType = 'MULTA'
        profit = Math.abs(tx.amount) // 100% del monto es ganancia
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
        await client.query(
          `
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
        `,
          [
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
          ]
        )
        inserted++
      } catch (err) {
        skipped++
      }
    }
    console.log(`   ✅ ${inserted} entries INCOME creados`)
    if (skipped > 0) console.log(`   ⚠️ ${skipped} omitidos`)
    sourceClient.release()

    // Paso 3: TRANSFER_IN
    const transferResult = await client.query(`
      INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
        id, "accountId", amount, "entryType", "sourceType",
        "profitAmount", "returnToCapital", "snapshotLeadId", "snapshotRouteId",
        "entryDate", description, "loanId", "loanPaymentId", "leadPaymentReceivedId",
        "destinationAccountId", "syncId", "createdAt"
      )
      SELECT gen_random_uuid()::text, t."destinationAccount", ABS(t.amount),
        'CREDIT'::"${TARGET_SCHEMA}"."AccountEntryType",
        'TRANSFER_IN'::"${TARGET_SCHEMA}"."SourceType",
        0, 0, '', '', t.date, COALESCE(t.description,''), NULL, NULL, NULL,
        t."sourceAccount", gen_random_uuid()::text, t."createdAt"
      FROM "${TARGET_SCHEMA}"."Transaction" t
      WHERE t.type = 'TRANSFER' AND t."destinationAccount" IS NOT NULL
    `)
    console.log(`   ✅ ${transferResult.rowCount} entries TRANSFER_IN creados`)

    // Paso 4: Reconciliación
    console.log('\n📊 Reconciliando balances...')
    const accounts = await client.query(`SELECT id, name, amount FROM "${TARGET_SCHEMA}"."Account"`)
    let adjustments = 0
    for (const acct of accounts.rows) {
      const sumResult = await client.query(
        `
        SELECT COALESCE(SUM(CASE WHEN "entryType"='CREDIT' THEN amount ELSE -amount END), 0)::numeric as calc
        FROM "${TARGET_SCHEMA}"."AccountEntry" WHERE "accountId" = $1
      `,
        [acct.id]
      )
      const diff = parseFloat(acct.amount) - parseFloat(sumResult.rows[0].calc)
      if (Math.abs(diff) > 0.0001) {
        const entryType = diff > 0 ? 'CREDIT' : 'DEBIT'
        await client.query(
          `
          INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
            id, "accountId", amount, "entryType", "sourceType",
            "profitAmount", "returnToCapital", "snapshotLeadId", "snapshotRouteId",
            "entryDate", description, "syncId", "createdAt"
          ) VALUES (
            gen_random_uuid()::text, $1, $2, $3::"${TARGET_SCHEMA}"."AccountEntryType",
            'BALANCE_ADJUSTMENT'::"${TARGET_SCHEMA}"."SourceType",
            0, 0, '', '', NOW(), 'Ajuste de reconciliación', gen_random_uuid()::text, NOW()
          )
        `,
          [acct.id, Math.abs(diff), entryType]
        )
        adjustments++
        console.log(`   ✅ ${acct.name}: ajuste de $${diff.toFixed(2)}`)
      }
    }
    console.log(`\n   ✅ ${adjustments} ajustes de balance creados`)

    // Resumen final
    const summary = await client.query(`
      SELECT "sourceType", "entryType", COUNT(*) as count, SUM(amount)::numeric(18,2) as total
      FROM "${TARGET_SCHEMA}"."AccountEntry"
      GROUP BY 1, 2
      ORDER BY 1, 2
    `)
    console.log('\n📊 Resumen de AccountEntry:')
    for (const row of summary.rows) {
      console.log(`   ${row.sourceType} (${row.entryType}): ${row.count} entries, $${row.total}`)
    }
  } finally {
    client.release()
    await sourcePool.end()
    await targetPool.end()
  }
}

run().catch(console.error)
