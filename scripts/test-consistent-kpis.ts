import 'dotenv/config'
import { prisma } from '@solufacil/database'
import {
  countActiveLoansAtDate,
  calculateClientBalance,
  buildRenewalMap,
  getWeeksInMonth,
  type LoanForPortfolio,
} from '@solufacil/business-logic'

async function test() {
  console.log('='.repeat(60))
  console.log('Test de KPIs Consistentes - Diciembre 2025')
  console.log('='.repeat(60))

  const year = 2025
  const month = 12
  const weeks = getWeeksInMonth(year, month - 1)
  const periodStart = weeks[0].start
  const periodEnd = weeks[weeks.length - 1].end
  const lastCompletedWeek = weeks[weeks.length - 1]

  console.log(`\nPeriodo: ${periodStart.toISOString()} - ${periodEnd.toISOString()}`)
  console.log(`Última semana: ${lastCompletedWeek.start.toISOString()} - ${lastCompletedWeek.end.toISOString()}`)

  // Query similar a getActiveLoansWithPaymentsForMonth
  const dbLoans = await prisma.loan.findMany({
    where: {
      signDate: { lte: periodEnd },
      excludedByCleanup: null,
      AND: [
        { OR: [{ finishedDate: null }, { finishedDate: { gte: periodStart } }] },
        { OR: [{ renewedDate: null }, { renewedDate: { gte: periodStart } }] },
      ],
    },
    select: {
      id: true,
      signDate: true,
      finishedDate: true,
      renewedDate: true,
      badDebtDate: true,
      pendingAmountStored: true,
      previousLoan: true,
      status: true,
      excludedByCleanup: true,
      requestedAmount: true,
      amountGived: true,
      totalDebtAcquired: true,
      totalPaid: true,
      loantypeRelation: {
        select: {
          weekDuration: true,
          rate: true,
        },
      },
    },
  })

  console.log(`\nPréstamos en query: ${dbLoans.length}`)

  // Convertir a LoanForPortfolio
  const loans: LoanForPortfolio[] = dbLoans.map((loan) => ({
    id: loan.id,
    pendingAmountStored: Number(loan.pendingAmountStored),
    signDate: loan.signDate,
    finishedDate: loan.finishedDate,
    renewedDate: loan.renewedDate,
    badDebtDate: loan.badDebtDate,
    excludedByCleanup: loan.excludedByCleanup,
    previousLoan: loan.previousLoan,
    status: loan.status,
    requestedAmount: Number(loan.requestedAmount),
    amountGived: Number(loan.amountGived),
    totalDebt: Number(loan.totalDebtAcquired),
    totalPaid: Number(loan.totalPaid),
    weekDuration: loan.loantypeRelation?.weekDuration,
    rate: loan.loantypeRelation ? Number(loan.loantypeRelation.rate) : undefined,
  }))

  // Build renewal map
  const renewalMap = buildRenewalMap(loans)

  // Calcular con datos consistentes
  const startReferenceDate = new Date(periodStart.getTime() - 1)
  const endReferenceDate = lastCompletedWeek.end

  const clientesActivosInicio = countActiveLoansAtDate(loans, startReferenceDate, renewalMap)
  const totalClientesActivos = countActiveLoansAtDate(loans, endReferenceDate, renewalMap)
  const clientBalance = calculateClientBalance(loans, periodStart, periodEnd)

  const incremento = totalClientesActivos - clientesActivosInicio

  console.log('\n📊 Resultados CONSISTENTES:')
  console.log(`   Clientes Activos INICIO: ${clientesActivosInicio}`)
  console.log(`   Clientes Activos FIN: ${totalClientesActivos}`)
  console.log(`   Incremento: ${incremento}`)
  console.log(``)
  console.log(`   Balance - Nuevos: ${clientBalance.nuevos}`)
  console.log(`   Balance - Terminados sin renovar: ${clientBalance.terminadosSinRenovar}`)
  console.log(`   Balance - Renovados: ${clientBalance.renovados}`)
  console.log(`   Balance calculado: ${clientBalance.balance}`)

  console.log('\n📐 Verificación matemática:')
  console.log(`   Incremento (${incremento}) == Nuevos (${clientBalance.nuevos}) - TerminadosSinRenovar (${clientBalance.terminadosSinRenovar})`)
  const expectedBalance = clientBalance.nuevos - clientBalance.terminadosSinRenovar
  console.log(`   ${incremento} == ${expectedBalance}? ${incremento === expectedBalance ? '✅ CORRECTO' : '❌ DIFERENCIA: ' + (incremento - expectedBalance)}`)

  await prisma.$disconnect()
}

test().catch(console.error)
