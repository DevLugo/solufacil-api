import { prisma } from '@solufacil/database'
import { getActiveWeekRange, getWeeksInMonth } from '@solufacil/business-logic'

async function debug() {

  try {
    // Get current week
    const now = new Date()
    const currentWeek = getActiveWeekRange(now)
    console.log('Current date:', now.toISOString())
    console.log('Current week:', {
      start: currentWeek.start.toISOString(),
      end: currentWeek.end.toISOString(),
      weekNumber: currentWeek.weekNumber,
    })

    // Find the route "CIUDAD"
    const ciudadRoute = await prisma.route.findFirst({
      where: { name: { contains: 'CIUDAD', mode: 'insensitive' } }
    })
    console.log('\nRoute CIUDAD:', ciudadRoute)

    if (!ciudadRoute) {
      console.log('Route CIUDAD not found')
      return
    }

    // Get active loans for this route
    const activeLoans = await prisma.loan.findMany({
      where: {
        snapshotRouteId: ciudadRoute.id,
        pendingAmountStored: { gt: 0 },
        badDebtDate: null,
        excludedByCleanup: null,
        renewedDate: null,
        finishedDate: null,
      },
      include: {
        payments: {
          where: {
            receivedAt: {
              gte: currentWeek.start,
              lte: currentWeek.end,
            },
          },
        },
        borrowerRelation: {
          include: {
            personalDataRelation: true,
          },
        },
      },
    })

    console.log('\nActive loans in CIUDAD:', activeLoans.length)

    let inCVCount = 0
    let alCorrienteCount = 0

    for (const loan of activeLoans) {
      const clientName = loan.borrowerRelation?.personalDataRelation?.fullName || 'N/A'
      const paymentsThisWeek = loan.payments.length
      const signedThisWeek = loan.signDate >= currentWeek.start && loan.signDate <= currentWeek.end

      // Check if loan is in CV
      const isInCV = !signedThisWeek && paymentsThisWeek === 0

      if (isInCV) {
        inCVCount++
      } else {
        alCorrienteCount++
      }

      console.log('  Loan', loan.id.slice(0, 8), '-', clientName)
      console.log('    Sign date:', loan.signDate.toISOString())
      console.log('    Signed this week:', signedThisWeek)
      console.log('    Payments this week:', paymentsThisWeek)
      console.log('    Is in CV:', isInCV)

      if (loan.payments.length > 0) {
        for (const p of loan.payments) {
          console.log('      Payment:', p.receivedAt.toISOString(), '- $' + p.amount)
        }
      }
    }

    console.log('\n=== SUMMARY ===')
    console.log('Total active loans:', activeLoans.length)
    console.log('In CV:', inCVCount)
    console.log('Al corriente:', alCorrienteCount)

    // Also check ALL payments for these loans in the last month
    const loanIds = activeLoans.map(l => l.id)
    const oneMonthAgo = new Date()
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)

    const recentPayments = await prisma.loanPayment.findMany({
      where: {
        loan: { in: loanIds },
        receivedAt: { gte: oneMonthAgo },
      },
      orderBy: { receivedAt: 'desc' },
    })

    console.log('\nAll payments in last month for these loans:', recentPayments.length)
    for (const p of recentPayments.slice(0, 20)) {
      console.log('  ', p.receivedAt.toISOString(), '- Loan', p.loan.slice(0, 8), '- $' + p.amount)
    }

  } finally {
    // no need to disconnect with singleton
  }
}

debug().catch(console.error)
