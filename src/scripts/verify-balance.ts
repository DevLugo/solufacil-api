import 'dotenv/config'
import { prisma } from '../../packages/database'

async function main() {
  const periodStart = new Date('2025-12-01T00:00:00.000Z')
  const periodEnd = new Date('2025-12-31T23:59:59.999Z')
  const beforePeriod = new Date('2025-11-30T23:59:59.999Z')

  console.log('=== ANÁLISIS CON LÓGICA MENSUAL (ANTES/DURANTE EL MES) ===\n')

  // Activos al inicio y final
  const activosInicioResult = await prisma.$queryRaw<[{ count: number }]>`
    SELECT COUNT(*)::int as count
    FROM "Loan" l
    WHERE l."signDate" <= ${beforePeriod}
    AND (l."finishedDate" IS NULL OR l."finishedDate" > ${beforePeriod})
    AND l."excludedByCleanup" IS NULL
    AND l.status != 'CANCELLED'
    AND NOT EXISTS (
      SELECT 1 FROM "Loan" l2
      WHERE l2."previousLoan" = l.id
      AND l2."signDate" <= ${beforePeriod}
    )
  `

  const activosFinalResult = await prisma.$queryRaw<[{ count: number }]>`
    SELECT COUNT(*)::int as count
    FROM "Loan" l
    WHERE l."signDate" <= ${periodEnd}
    AND (l."finishedDate" IS NULL OR l."finishedDate" > ${periodEnd})
    AND l."excludedByCleanup" IS NULL
    AND l.status != 'CANCELLED'
    AND NOT EXISTS (
      SELECT 1 FROM "Loan" l2
      WHERE l2."previousLoan" = l.id
      AND l2."signDate" <= ${periodEnd}
    )
  `

  const inicio = activosInicioResult[0].count
  const final = activosFinalResult[0].count
  const incrementoReal = final - inicio

  console.log('Activos Inicio (30 nov): ' + inicio)
  console.log('Activos Final (31 dic):  ' + final)
  console.log('Incremento Real: ' + incrementoReal + '\n')

  // Nuevos (sin previousLoan, firmados en diciembre)
  const nuevos = await prisma.loan.count({
    where: {
      previousLoan: null,
      signDate: { gte: periodStart, lte: periodEnd },
      status: { not: 'CANCELLED' }
    }
  })

  // Préstamos con previousLoan firmados en diciembre
  const conPrevious = await prisma.loan.findMany({
    where: {
      previousLoan: { not: null },
      signDate: { gte: periodStart, lte: periodEnd },
      status: { not: 'CANCELLED' }
    },
    select: {
      id: true,
      signDate: true,
      previousLoan: true,
      previousLoanRelation: {
        select: { finishedDate: true }
      }
    }
  })

  let renovaciones = 0  // Previous loan finished DURING the month (>= periodStart)
  let reintegros = 0    // Previous loan finished BEFORE the month (< periodStart)
  let sinFechaAnterior = 0

  for (const loan of conPrevious) {
    const prevFinished = loan.previousLoanRelation?.finishedDate
    if (!prevFinished) {
      sinFechaAnterior++
      renovaciones++ // Fallback: assume renovation
      continue
    }

    if (prevFinished >= periodStart) {
      renovaciones++  // Previous finished DURING the month = renovation (neutral)
    } else {
      reintegros++    // Previous finished BEFORE the month = reintegro (adds to balance)
    }
  }

  // Terminados sin renovar (finished in the month and no new loan references them)
  const terminadosSinRenovarResult = await prisma.$queryRaw<[{ count: number }]>`
    SELECT COUNT(*)::int as count
    FROM "Loan" l
    WHERE l."finishedDate" >= ${periodStart} AND l."finishedDate" <= ${periodEnd}
    AND l.status = 'FINISHED'
    AND NOT EXISTS (SELECT 1 FROM "Loan" l2 WHERE l2."previousLoan" = l.id)
  `
  const terminadosSinRenovar = terminadosSinRenovarResult[0].count

  console.log('=== MOVIMIENTOS EN DICIEMBRE (Lógica Mensual) ===')
  console.log('Nuevos (primer préstamo):              ' + nuevos)
  console.log('Renovaciones (prev terminó en dic):    ' + renovaciones + ' (neutrales)')
  console.log('Reintegros (prev terminó antes dic):   ' + reintegros + ' (suman al balance)')
  console.log('Terminados sin renovar:                ' + terminadosSinRenovar)
  console.log('(Sin fecha anterior:                   ' + sinFechaAnterior + ')\n')

  const incrementoCalc = nuevos + reintegros - terminadosSinRenovar

  console.log('=== VERIFICACIÓN ===')
  console.log('Fórmula: Nuevos + Reintegros - TerminadosSinRenovar')
  console.log('         ' + nuevos + ' + ' + reintegros + ' - ' + terminadosSinRenovar + ' = ' + incrementoCalc)
  console.log('')
  console.log('Incremento Real:      ' + incrementoReal)
  console.log('Incremento Calculado: ' + incrementoCalc)
  console.log('Diferencia:           ' + (incrementoReal - incrementoCalc))

  if (incrementoReal === incrementoCalc) {
    console.log('\n✅ ¡La matemática cuadra!')
  } else {
    console.log('\n⚠️  Diferencia de ' + Math.abs(incrementoReal - incrementoCalc))
  }

  await prisma.$disconnect()
}

main().catch(console.error)
