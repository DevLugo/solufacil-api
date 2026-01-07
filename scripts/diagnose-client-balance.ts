import 'dotenv/config'
import { prisma } from '@solufacil/database'

async function diagnose() {
  console.log('='.repeat(60))
  console.log('Diagnóstico de Balance de Clientes - Diciembre 2025')
  console.log('='.repeat(60))

  const periodStart = new Date('2025-12-01T00:00:00.000Z')
  const periodEnd = new Date('2025-12-31T23:59:59.999Z')
  const prevMonthEnd = new Date('2025-11-30T23:59:59.999Z')

  // 1. Clientes activos al INICIO del mes (fin de noviembre)
  const activosInicio = await prisma.$queryRaw<[{ total: bigint }]>`
    SELECT COUNT(*) as total
    FROM "Loan"
    WHERE status != 'CANCELLED'
      AND "renewedDate" IS NULL
      AND "pendingAmountStored" > 0
      AND "badDebtDate" IS NULL
      AND "excludedByCleanup" IS NULL
      AND "signDate" <= ${prevMonthEnd}
  `
  console.log('\n1. Clientes Activos INICIO (30 nov):', activosInicio[0].total.toString())

  // 2. Clientes activos al FINAL del mes (fin de diciembre)
  const activosFin = await prisma.$queryRaw<[{ total: bigint }]>`
    SELECT COUNT(*) as total
    FROM "Loan"
    WHERE status != 'CANCELLED'
      AND "renewedDate" IS NULL
      AND "pendingAmountStored" > 0
      AND "badDebtDate" IS NULL
      AND "excludedByCleanup" IS NULL
      AND "signDate" <= ${periodEnd}
  `
  console.log('2. Clientes Activos FIN (31 dic):', activosFin[0].total.toString())

  const incrementoReal = Number(activosFin[0].total) - Number(activosInicio[0].total)
  console.log('3. Incremento REAL:', incrementoReal)

  // 4. Nuevos clientes (previousLoan = null, firmados en diciembre)
  const nuevos = await prisma.$queryRaw<[{ total: bigint }]>`
    SELECT COUNT(*) as total
    FROM "Loan"
    WHERE "previousLoan" IS NULL
      AND "signDate" >= ${periodStart}
      AND "signDate" <= ${periodEnd}
  `
  console.log('\n4. Clientes NUEVOS (previousLoan=null, firmados en dic):', nuevos[0].total.toString())

  // 5. Terminados sin renovar en diciembre
  const terminadosSinRenovar = await prisma.$queryRaw<[{ total: bigint }]>`
    SELECT COUNT(*) as total
    FROM "Loan" l
    WHERE l."finishedDate" >= ${periodStart}
      AND l."finishedDate" <= ${periodEnd}
      AND NOT EXISTS (SELECT 1 FROM "Loan" l2 WHERE l2."previousLoan" = l.id)
  `
  console.log('5. Terminados SIN renovar:', terminadosSinRenovar[0].total.toString())

  // 6. Terminados CON renovación (el préstamo anterior)
  const terminadosConRenovacion = await prisma.$queryRaw<[{ total: bigint }]>`
    SELECT COUNT(*) as total
    FROM "Loan" l
    WHERE l."finishedDate" >= ${periodStart}
      AND l."finishedDate" <= ${periodEnd}
      AND EXISTS (SELECT 1 FROM "Loan" l2 WHERE l2."previousLoan" = l.id)
  `
  console.log('6. Terminados CON renovación:', terminadosConRenovacion[0].total.toString())

  // 7. Nuevos préstamos de renovación (tienen previousLoan)
  const renovaciones = await prisma.$queryRaw<[{ total: bigint }]>`
    SELECT COUNT(*) as total
    FROM "Loan"
    WHERE "previousLoan" IS NOT NULL
      AND "signDate" >= ${periodStart}
      AND "signDate" <= ${periodEnd}
  `
  console.log('7. Préstamos de renovación (previousLoan!=null):', renovaciones[0].total.toString())

  // Balance esperado
  const nuevosNum = Number(nuevos[0].total)
  const terminadosNum = Number(terminadosSinRenovar[0].total)
  const balanceEsperado = nuevosNum - terminadosNum

  console.log('\n' + '='.repeat(60))
  console.log('ANÁLISIS:')
  console.log('='.repeat(60))
  console.log(`Balance esperado (Nuevos - TerminadosSinRenovar): ${nuevosNum} - ${terminadosNum} = ${balanceEsperado}`)
  console.log(`Incremento real (ActivosFin - ActivosInicio): ${incrementoReal}`)

  if (balanceEsperado !== incrementoReal) {
    console.log(`\n⚠️ DISCREPANCIA: ${incrementoReal - balanceEsperado}`)
    console.log('\nPosibles causas:')

    // 8. Préstamos que pasaron a bad debt
    const badDebt = await prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COUNT(*) as total
      FROM "Loan"
      WHERE "badDebtDate" >= ${periodStart}
        AND "badDebtDate" <= ${periodEnd}
    `
    console.log(`   - Pasaron a Bad Debt en dic: ${badDebt[0].total}`)

    // 9. Préstamos excluidos por cleanup
    const excluded = await prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COUNT(*) as total
      FROM "Loan"
      WHERE "excludedByCleanup" IS NOT NULL
        AND "updatedAt" >= ${periodStart}
        AND "updatedAt" <= ${periodEnd}
    `
    console.log(`   - Excluidos por cleanup en dic: ${excluded[0].total}`)

    // 10. Verificar si la query de "nuevos" excluye préstamos que ya terminaron
    const nuevosYaTerminados = await prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COUNT(*) as total
      FROM "Loan"
      WHERE "previousLoan" IS NULL
        AND "signDate" >= ${periodStart}
        AND "signDate" <= ${periodEnd}
        AND ("finishedDate" IS NOT NULL OR "renewedDate" IS NOT NULL)
    `
    console.log(`   - Nuevos que ya terminaron/renovaron: ${nuevosYaTerminados[0].total}`)
  }

  await prisma.$disconnect()
}

diagnose().catch(console.error)
