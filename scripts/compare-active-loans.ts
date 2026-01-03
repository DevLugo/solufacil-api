import { prisma } from '@solufacil/database'
import { getWeeksInMonth, getActiveWeekRange } from '@solufacil/business-logic'

async function main() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  // Get current week (what mobile uses)
  const currentWeek = getActiveWeekRange(now)
  console.log('=== CURRENT WEEK (Mobile logic) ===')
  console.log(`Week: ${currentWeek.weekNumber}`)
  console.log(`Start: ${currentWeek.start.toISOString()}`)
  console.log(`End: ${currentWeek.end.toISOString()}`)

  // Get last completed week (what web uses)
  // If no completed weeks this month, use last month
  let weeks = getWeeksInMonth(year, month - 1)
  let completedWeeks = weeks.filter(w => w.end < now)

  if (completedWeeks.length === 0) {
    // Use previous month
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    console.log(`\nNo completed weeks in ${month}/${year}, using ${prevMonth}/${prevYear}`)
    weeks = getWeeksInMonth(prevYear, prevMonth - 1)
    completedWeeks = weeks.filter(w => w.end < now)
  }

  const lastCompletedWeek = completedWeeks[completedWeeks.length - 1]

  console.log('\n=== LAST COMPLETED WEEK (Web logic) ===')
  if (lastCompletedWeek) {
    console.log(`Week: ${lastCompletedWeek.weekNumber}`)
    console.log(`Start: ${lastCompletedWeek.start.toISOString()}`)
    console.log(`End: ${lastCompletedWeek.end.toISOString()}`)
  } else {
    console.log('No completed weeks this month yet')
  }

  // Query 1: Mobile logic (current week)
  const mobileLoans = await prisma.loan.findMany({
    where: {
      excludedByCleanup: null,
      signDate: { lte: currentWeek.end },
      AND: [
        { OR: [{ finishedDate: null }, { finishedDate: { gte: currentWeek.start } }] },
        { OR: [{ renewedDate: null }, { renewedDate: { gte: currentWeek.start } }] },
      ],
    },
    select: { id: true, signDate: true, finishedDate: true, renewedDate: true },
  })

  // Filter stillActiveAtWeekEnd
  const mobileActive = mobileLoans.filter(loan => {
    const finishedAfterWeekEnd = loan.finishedDate === null || loan.finishedDate > currentWeek.end
    const renewedAfterWeekEnd = loan.renewedDate === null || loan.renewedDate > currentWeek.end
    return finishedAfterWeekEnd && renewedAfterWeekEnd
  })

  console.log(`\nMobile active loans (current week): ${mobileActive.length}`)

  // Query 2: Web logic (last completed week)
  if (lastCompletedWeek) {
    const webLoans = await prisma.loan.findMany({
      where: {
        excludedByCleanup: null,
        signDate: { lte: lastCompletedWeek.end },
        AND: [
          { OR: [{ finishedDate: null }, { finishedDate: { gte: lastCompletedWeek.start } }] },
          { OR: [{ renewedDate: null }, { renewedDate: { gte: lastCompletedWeek.start } }] },
        ],
      },
      select: { id: true, signDate: true, finishedDate: true, renewedDate: true },
    })

    const webActive = webLoans.filter(loan => {
      const finishedAfterWeekEnd = loan.finishedDate === null || loan.finishedDate > lastCompletedWeek.end
      const renewedAfterWeekEnd = loan.renewedDate === null || loan.renewedDate > lastCompletedWeek.end
      return finishedAfterWeekEnd && renewedAfterWeekEnd
    })

    console.log(`Web active loans (last completed week): ${webActive.length}`)

    // Find difference
    const mobileIds = new Set(mobileActive.map(l => l.id))
    const webIds = new Set(webActive.map(l => l.id))

    const onlyInMobile = mobileActive.filter(l => !webIds.has(l.id))
    const onlyInWeb = webActive.filter(l => !mobileIds.has(l.id))

    console.log(`\nOnly in Mobile (${onlyInMobile.length}):`)
    for (const loan of onlyInMobile.slice(0, 10)) {
      console.log(`  ${loan.id} - signed: ${loan.signDate?.toISOString()} finished: ${loan.finishedDate?.toISOString()} renewed: ${loan.renewedDate?.toISOString()}`)
    }

    console.log(`\nOnly in Web (${onlyInWeb.length}):`)
    for (const loan of onlyInWeb.slice(0, 10)) {
      console.log(`  ${loan.id} - signed: ${loan.signDate?.toISOString()} finished: ${loan.finishedDate?.toISOString()} renewed: ${loan.renewedDate?.toISOString()}`)
    }
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit(0))
