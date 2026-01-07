import 'dotenv/config'
import { prisma } from '@solufacil/database'
import { calculateRenovationKPIs } from '@solufacil/business-logic'
import type { LoanForPortfolio } from '@solufacil/business-logic'

async function test() {
  console.log('='.repeat(60))
  console.log('Test de getRenovationKPIs - Diciembre 2025')
  console.log('='.repeat(60))

  // Simular el periodo del reporte mensual (diciembre 2025)
  // Las semanas se calculan de lunes a domingo
  const periodStart = new Date('2025-12-01T00:00:00.000Z')
  const periodEnd = new Date('2025-12-31T23:59:59.999Z')

  console.log(`\nPeriodo: ${periodStart.toISOString()} - ${periodEnd.toISOString()}`)

  // Ejecutar la misma query que getRenovationKPIs
  const loans = await prisma.$queryRawUnsafe<Array<{
    id: string
    signDate: Date
    finishedDate: Date | null
    renewedDate: Date | null
    badDebtDate: Date | null
    previousLoan: string | null
    status: string
    pendingAmountStored: string
    wasRenewed: boolean
    requestedAmount: string
    amountGived: string
  }>>(`
    SELECT
      l.id,
      l."signDate",
      l."finishedDate",
      l."renewedDate",
      l."badDebtDate",
      l."previousLoan",
      l.status,
      l."pendingAmountStored"::text,
      l."requestedAmount"::text,
      l."amountGived"::text,
      EXISTS (SELECT 1 FROM "Loan" l2 WHERE l2."previousLoan" = l.id) as "wasRenewed"
    FROM "Loan" l
    WHERE (
      (l."previousLoan" IS NOT NULL AND l."signDate" >= $1 AND l."signDate" <= $2)
      OR (l."finishedDate" >= $1 AND l."finishedDate" <= $2)
    )
  `, periodStart, periodEnd)

  console.log(`\nTotal préstamos en query: ${loans.length}`)

  // Convertir a LoanForPortfolio
  const portfolioLoans: LoanForPortfolio[] = loans.map((loan) => ({
    id: loan.id,
    pendingAmountStored: parseFloat(loan.pendingAmountStored),
    signDate: loan.signDate,
    finishedDate: loan.finishedDate,
    renewedDate: loan.renewedDate,
    badDebtDate: loan.badDebtDate,
    excludedByCleanup: null,
    previousLoan: loan.previousLoan,
    status: loan.status,
    wasRenewed: loan.wasRenewed,
    requestedAmount: parseFloat(loan.requestedAmount),
    amountGived: parseFloat(loan.amountGived),
  }))

  // Calcular KPIs
  const kpis = calculateRenovationKPIs(portfolioLoans, periodStart, periodEnd)

  console.log('\n📊 Resultados:')
  console.log(`   Total Renovaciones: ${kpis.totalRenovaciones}`)
  console.log(`   Total Cierres Sin Renovar: ${kpis.totalCierresSinRenovar}`)
  console.log(`   Tasa Renovación: ${(kpis.tasaRenovacion * 100).toFixed(2)}%`)

  // Debug: contar manualmente
  let renovaciones = 0
  let cierresSinRenovar = 0

  for (const loan of portfolioLoans) {
    // Renovación: previousLoan + signDate en periodo + amountGived < requestedAmount
    if (
      loan.previousLoan !== null &&
      loan.signDate >= periodStart &&
      loan.signDate <= periodEnd
    ) {
      if (loan.amountGived !== undefined && loan.requestedAmount !== undefined) {
        if (loan.amountGived < loan.requestedAmount) {
          renovaciones++
        }
      }
    }

    // Cierre sin renovar: finishedDate en periodo + no fue renovado
    if (
      loan.finishedDate !== null &&
      loan.finishedDate >= periodStart &&
      loan.finishedDate <= periodEnd
    ) {
      const wasRenewed = loan.wasRenewed !== undefined ? loan.wasRenewed : loan.renewedDate !== null
      if (!wasRenewed) {
        cierresSinRenovar++
      }
    }
  }

  console.log('\n🔍 Conteo manual:')
  console.log(`   Renovaciones: ${renovaciones}`)
  console.log(`   Cierres sin renovar: ${cierresSinRenovar}`)

  await prisma.$disconnect()
}

test().catch(console.error)
