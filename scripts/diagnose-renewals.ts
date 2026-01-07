import 'dotenv/config'
import { prisma } from '@solufacil/database'

async function diagnose() {
  console.log('='.repeat(60))
  console.log('Diagnóstico de Renovaciones - Diciembre 2025')
  console.log('='.repeat(60))

  // 1. Préstamos con previousLoan firmados en diciembre
  const withPrevLoan = await prisma.$queryRaw<[{ total: bigint }]>`
    SELECT COUNT(*) as total
    FROM "Loan"
    WHERE "previousLoan" IS NOT NULL
      AND "signDate" >= '2025-12-01'
      AND "signDate" <= '2025-12-31'
  `
  console.log('\n1. Préstamos con previousLoan en dic:', withPrevLoan[0].total.toString())

  // 2. De esos, cuántos tienen amountGived < requestedAmount (renovación verdadera)
  const trueRenewals = await prisma.$queryRaw<[{ total: bigint }]>`
    SELECT COUNT(*) as total
    FROM "Loan"
    WHERE "previousLoan" IS NOT NULL
      AND "signDate" >= '2025-12-01'
      AND "signDate" <= '2025-12-31'
      AND "amountGived" < "requestedAmount"
  `
  console.log('2. Renovaciones VERDADERAS (amountGived < requestedAmount):', trueRenewals[0].total.toString())

  // 3. Préstamos con previousLoan donde amountGived == requestedAmount (NO son renovación)
  const notRenewals = await prisma.$queryRaw<[{ total: bigint }]>`
    SELECT COUNT(*) as total
    FROM "Loan"
    WHERE "previousLoan" IS NOT NULL
      AND "signDate" >= '2025-12-01'
      AND "signDate" <= '2025-12-31'
      AND "amountGived" = "requestedAmount"
  `
  console.log('3. Créditos a cliente existente (NO renovación):', notRenewals[0].total.toString())

  // 4. Ejemplos de los datos
  const examples = await prisma.$queryRaw<Array<{
    id: string
    signDate: Date
    requestedAmount: string
    amountGived: string
    deudaDescontada: string
  }>>`
    SELECT
      id,
      "signDate",
      "requestedAmount"::text,
      "amountGived"::text,
      ("requestedAmount" - "amountGived")::text as "deudaDescontada"
    FROM "Loan"
    WHERE "previousLoan" IS NOT NULL
      AND "signDate" >= '2025-12-01'
      AND "signDate" <= '2025-12-31'
    ORDER BY "signDate" DESC
    LIMIT 10
  `
  console.log('\n4. Ejemplos de préstamos con previousLoan (primeros 10):')
  examples.forEach((e, i) => {
    const isRenewal = parseFloat(e.amountGived) < parseFloat(e.requestedAmount)
    console.log(`   ${i + 1}. ${e.signDate.toISOString().slice(0, 10)} | requested=${e.requestedAmount} | gived=${e.amountGived} | deuda=${e.deudaDescontada} | ${isRenewal ? '✅ RENOVACIÓN' : '❌ NO renovación'}`)
  })

  // 5. Verificar qué trae la query actual del servicio
  console.log('\n5. Lo que debería traer getRenovationKPIs:')
  const queryResult = await prisma.$queryRaw<Array<{
    id: string
    signDate: Date
    previousLoan: string | null
    requestedAmount: string
    amountGived: string
  }>>`
    SELECT
      l.id,
      l."signDate",
      l."previousLoan",
      l."requestedAmount"::text,
      l."amountGived"::text
    FROM "Loan" l
    WHERE (
      (l."previousLoan" IS NOT NULL AND l."signDate" >= '2025-12-01' AND l."signDate" <= '2025-12-31')
      OR (l."finishedDate" >= '2025-12-01' AND l."finishedDate" <= '2025-12-31')
    )
    LIMIT 20
  `
  console.log(`   Total rows: ${queryResult.length}`)
  const renewalsFromQuery = queryResult.filter(r =>
    r.previousLoan !== null &&
    parseFloat(r.amountGived) < parseFloat(r.requestedAmount)
  )
  console.log(`   Renovaciones verdaderas en resultado: ${renewalsFromQuery.length}`)

  await prisma.$disconnect()
}

diagnose().catch(console.error)
