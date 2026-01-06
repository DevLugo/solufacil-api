import { Decimal } from 'decimal.js'
import type { PrismaClient, LoanStatus } from '@solufacil/database'

export interface ActiveLoansBreakdown {
  total: number           // Total active loans
  alCorriente: number     // Loans that are current (have received payment in the month)
  carteraVencida: number  // Loans that are overdue (CV - no payment in month or marked as overdue)
}

export interface FinancialSummary {
  activeLoans: number
  activeLoansBreakdown: ActiveLoansBreakdown
  totalPortfolio: Decimal
  totalPaid: Decimal
  pendingAmount: Decimal
  averagePayment: Decimal
}

export interface WeeklyData {
  week: number
  date: Date
  loansGranted: number
  paymentsReceived: Decimal
  paymentsCount: number
  expectedPayments: Decimal
  recoveryRate: Decimal
}

export interface ComparisonData {
  previousMonth: FinancialSummary
  growth: Decimal
  trend: string
}

export interface PerformanceMetrics {
  recoveryRate: Decimal
  averageTicket: Decimal
  activeLoansCount: number
  finishedLoansCount: number
}

export interface FinancialReport {
  summary: FinancialSummary
  weeklyData: WeeklyData[]
  comparisonData: ComparisonData | null
  performanceMetrics: PerformanceMetrics
}

export interface BadDebtData {
  routeId: string
  routeName: string
  loanCount: number
  totalAmount: Decimal
}

export interface BadDebtSummary {
  totalLoans: number
  totalAmount: Decimal
  byRoute: BadDebtData[]
}

export class ReportService {
  constructor(private prisma: PrismaClient) {}

  // ========== Private Helper Methods ==========

  /**
   * Builds the route filter condition for querying loans.
   * Matches loans where:
   * - snapshotRouteId is in routeIds, OR
   * - The lead's current routes include a route in routeIds
   */
  private getRouteFilterCondition(routeIds: string[]) {
    return {
      OR: [
        { snapshotRouteId: { in: routeIds } },
        {
          leadRelation: {
            routes: {
              some: { id: { in: routeIds } },
            },
          },
        },
      ],
    }
  }

  /**
   * Builds the base WHERE clause for querying active loans.
   */
  private getActiveLoansWhereClause(
    routeIds: string[],
    signDateFilter?: { lte?: Date; gte?: Date }
  ) {
    return {
      ...this.getRouteFilterCondition(routeIds),
      finishedDate: null,
      pendingAmountStored: { gt: 0 },
      excludedByCleanup: null,
      ...(signDateFilter && { signDate: signDateFilter }),
    }
  }

  /**
   * Calculates CV breakdown (Al Corriente vs Cartera Vencida) from loans with payments.
   */
  private calculateCVBreakdown(
    loansWithPayments: Array<{ payments: { id: string }[] }>
  ): { alCorriente: number; carteraVencida: number } {
    let alCorriente = 0
    let carteraVencida = 0

    for (const loan of loansWithPayments) {
      if (loan.payments.length > 0) {
        alCorriente++
      } else {
        carteraVencida++
      }
    }

    return { alCorriente, carteraVencida }
  }

  /**
   * Calculates loan totals (portfolio, paid, pending, average).
   */
  private calculateLoanTotals(
    loans: Array<{
      totalDebtAcquired: { toString(): string }
      totalPaid: { toString(): string }
      pendingAmountStored: { toString(): string }
    }>
  ): {
    totalPortfolio: Decimal
    totalPaid: Decimal
    pendingAmount: Decimal
    averagePayment: Decimal
  } {
    const totalPortfolio = loans.reduce(
      (acc, loan) => acc.plus(new Decimal(loan.totalDebtAcquired.toString())),
      new Decimal(0)
    )

    const totalPaid = loans.reduce(
      (acc, loan) => acc.plus(new Decimal(loan.totalPaid.toString())),
      new Decimal(0)
    )

    const pendingAmount = loans.reduce(
      (acc, loan) => acc.plus(new Decimal(loan.pendingAmountStored.toString())),
      new Decimal(0)
    )

    const averagePayment =
      loans.length > 0
        ? totalPaid.dividedBy(loans.length).toDecimalPlaces(2)
        : new Decimal(0)

    return { totalPortfolio, totalPaid, pendingAmount, averagePayment }
  }

  // ========== Public Methods ==========

  async getFinancialReport(
    routeIds: string[],
    year: number,
    month: number
  ): Promise<FinancialReport> {
    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0, 23, 59, 59)

    // Get loans for the specified routes and period
    // Filter by snapshotRouteId OR lead's current routes
    const loans = await this.prisma.loan.findMany({
      where: {
        ...this.getRouteFilterCondition(routeIds),
        signDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        payments: {
          where: {
            receivedAt: {
              gte: startDate,
              lte: endDate,
            },
          },
        },
        loantypeRelation: true,
      },
    })

    // Calculate summary
    // Active loans: same logic as LoanRepository.findMany with status=ACTIVE
    // - finishedDate: null (not finished)
    // - pendingAmountStored > 0 (has pending payments)
    // - excludedByCleanup: null (not excluded by cleanup)

    // Get active loans with their payments for CV calculation
    const activeLoansWithPayments = await this.prisma.loan.findMany({
      where: this.getActiveLoansWhereClause(routeIds),
      select: {
        id: true,
        totalDebtAcquired: true,
        totalPaid: true,
        pendingAmountStored: true,
        badDebtDate: true,
        payments: {
          where: {
            receivedAt: {
              gte: startDate,
              lte: endDate,
            },
          },
          select: {
            id: true,
          },
        },
      },
    })

    const activeLoans = activeLoansWithPayments.length

    // Calculate CV breakdown using helper
    const { alCorriente, carteraVencida } =
      this.calculateCVBreakdown(activeLoansWithPayments)

    const activeLoansBreakdown: ActiveLoansBreakdown = {
      total: activeLoans,
      alCorriente,
      carteraVencida,
    }

    // Calculate loan totals using helper
    const { totalPortfolio, totalPaid, pendingAmount, averagePayment } =
      this.calculateLoanTotals(activeLoansWithPayments)

    const summary: FinancialSummary = {
      activeLoans,
      activeLoansBreakdown,
      totalPortfolio,
      totalPaid,
      pendingAmount,
      averagePayment,
    }

    // Calculate weekly data
    const weeklyData = await this.calculateWeeklyData(routeIds, year, month)

    // Calculate comparison with previous month
    const comparisonData = await this.getComparisonData(routeIds, year, month)

    // Calculate performance metrics
    const performanceMetrics = await this.calculatePerformanceMetrics(routeIds)

    return {
      summary,
      weeklyData,
      comparisonData,
      performanceMetrics,
    }
  }

  private async calculateWeeklyData(
    routeIds: string[],
    year: number,
    month: number
  ): Promise<WeeklyData[]> {
    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0, 23, 59, 59)

    // OPTIMIZATION: Get all data for the month in 3 queries instead of N*3 queries
    // Query 1: Get all loans granted in the month
    // Filter by snapshotRouteId OR lead's current routes
    const allLoansGranted = await this.prisma.loan.findMany({
      where: {
        ...this.getRouteFilterCondition(routeIds),
        signDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        signDate: true,
      },
    })

    // Query 2: Get all payments for the month
    // Filter by loan's snapshotRouteId OR lead's current routes
    const allPayments = await this.prisma.loanPayment.findMany({
      where: {
        loanRelation: this.getRouteFilterCondition(routeIds),
        receivedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        amount: true,
        receivedAt: true,
      },
    })

    // Query 3: Get all active loans (for expected payments calculation)
    const allActiveLoans = await this.prisma.loan.findMany({
      where: this.getActiveLoansWhereClause(routeIds, { lte: endDate }),
      select: {
        id: true,
        expectedWeeklyPayment: true,
        signDate: true,
      },
    })

    // Now calculate weekly data by filtering in memory
    const weeklyData: WeeklyData[] = []
    let currentWeekStart: Date = new Date(startDate)
    let weekNumber = 1

    while (currentWeekStart <= endDate) {
      const currentWeekEnd = new Date(currentWeekStart)
      currentWeekEnd.setDate(currentWeekStart.getDate() + 6)

      if (currentWeekEnd > endDate) {
        currentWeekEnd.setTime(endDate.getTime())
      }

      // Filter loans granted this week
      const loansGranted = allLoansGranted.filter(
        (loan) => loan.signDate >= currentWeekStart && loan.signDate <= currentWeekEnd
      ).length

      // Filter payments received this week
      const weekPayments = allPayments.filter(
        (payment) => payment.receivedAt >= currentWeekStart && payment.receivedAt <= currentWeekEnd
      )

      const paymentsReceived = weekPayments.reduce(
        (acc, payment) => acc.plus(new Decimal(payment.amount.toString())),
        new Decimal(0)
      )

      // Filter active loans that were active by the end of this week
      const activeLoans = allActiveLoans.filter(
        (loan) => loan.signDate <= currentWeekEnd
      )

      const expectedPayments = activeLoans.reduce(
        (acc, loan) => acc.plus(new Decimal(loan.expectedWeeklyPayment.toString())),
        new Decimal(0)
      )

      const recoveryRate = expectedPayments.greaterThan(0)
        ? paymentsReceived.dividedBy(expectedPayments).times(100).toDecimalPlaces(2)
        : new Decimal(0)

      weeklyData.push({
        week: weekNumber,
        date: new Date(currentWeekStart),
        loansGranted,
        paymentsReceived,
        paymentsCount: weekPayments.length,
        expectedPayments,
        recoveryRate,
      })

      // Create new Date instead of mutating to avoid side effects
      currentWeekStart = new Date(currentWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000)
      weekNumber++
    }

    return weeklyData
  }

  private async getComparisonData(
    routeIds: string[],
    year: number,
    month: number
  ): Promise<ComparisonData | null> {
    // Get previous month
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year

    const prevStartDate = new Date(prevYear, prevMonth - 1, 1)
    const prevEndDate = new Date(prevYear, prevMonth, 0, 23, 59, 59)

    // Get active loans for previous month with payments for CV calculation
    const prevActiveLoansWithPayments = await this.prisma.loan.findMany({
      where: this.getActiveLoansWhereClause(routeIds, { lte: prevEndDate }),
      select: {
        id: true,
        totalDebtAcquired: true,
        totalPaid: true,
        pendingAmountStored: true,
        payments: {
          where: {
            receivedAt: {
              gte: prevStartDate,
              lte: prevEndDate,
            },
          },
          select: { id: true },
        },
      },
    })

    if (prevActiveLoansWithPayments.length === 0) {
      return null
    }

    // Calculate CV breakdown for previous month using helper
    const { alCorriente: prevAlCorriente, carteraVencida: prevCarteraVencida } =
      this.calculateCVBreakdown(prevActiveLoansWithPayments)

    // Calculate loan totals using helper
    const {
      totalPortfolio: prevTotalPortfolio,
      totalPaid: prevTotalPaid,
      pendingAmount: prevPendingAmount,
      averagePayment: prevAveragePayment,
    } = this.calculateLoanTotals(prevActiveLoansWithPayments)

    const prevActiveLoans = prevActiveLoansWithPayments.length

    const previousMonth: FinancialSummary = {
      activeLoans: prevActiveLoans,
      activeLoansBreakdown: {
        total: prevActiveLoans,
        alCorriente: prevAlCorriente,
        carteraVencida: prevCarteraVencida,
      },
      totalPortfolio: prevTotalPortfolio,
      totalPaid: prevTotalPaid,
      pendingAmount: prevPendingAmount,
      averagePayment: prevAveragePayment,
    }

    // Calculate current month totals for comparison
    const currentStartDate = new Date(year, month - 1, 1)
    const currentEndDate = new Date(year, month, 0, 23, 59, 59)

    const currentLoans = await this.prisma.loan.findMany({
      where: {
        ...this.getRouteFilterCondition(routeIds),
        signDate: {
          gte: currentStartDate,
          lte: currentEndDate,
        },
      },
      select: {
        totalDebtAcquired: true,
      },
    })

    const currentTotalPortfolio = currentLoans.reduce(
      (acc, loan) => acc.plus(new Decimal(loan.totalDebtAcquired.toString())),
      new Decimal(0)
    )

    const growth = prevTotalPortfolio.greaterThan(0)
      ? currentTotalPortfolio.minus(prevTotalPortfolio)
          .dividedBy(prevTotalPortfolio)
          .times(100)
          .toDecimalPlaces(2)
      : new Decimal(0)

    const trend = growth.greaterThan(0)
      ? 'UP'
      : growth.lessThan(0)
        ? 'DOWN'
        : 'STABLE'

    return {
      previousMonth,
      growth,
      trend,
    }
  }

  private async calculatePerformanceMetrics(
    routeIds: string[]
  ): Promise<PerformanceMetrics> {
    const activeLoansWhereClause = this.getActiveLoansWhereClause(routeIds)

    const activeLoansCount = await this.prisma.loan.count({
      where: activeLoansWhereClause,
    })

    const finishedLoansCount = await this.prisma.loan.count({
      where: {
        ...this.getRouteFilterCondition(routeIds),
        finishedDate: { not: null },
      },
    })

    const activeLoans = await this.prisma.loan.findMany({
      where: activeLoansWhereClause,
      select: {
        totalDebtAcquired: true,
        totalPaid: true,
        requestedAmount: true,
      },
    })

    const totalExpected = activeLoans.reduce(
      (acc, loan) => acc.plus(new Decimal(loan.totalDebtAcquired.toString())),
      new Decimal(0)
    )

    const totalReceived = activeLoans.reduce(
      (acc, loan) => acc.plus(new Decimal(loan.totalPaid.toString())),
      new Decimal(0)
    )

    const recoveryRate = totalExpected.greaterThan(0)
      ? totalReceived.dividedBy(totalExpected).times(100).toDecimalPlaces(2)
      : new Decimal(0)

    const totalRequestedAmount = activeLoans.reduce(
      (acc, loan) => acc.plus(new Decimal(loan.requestedAmount.toString())),
      new Decimal(0)
    )

    const averageTicket = activeLoansCount > 0
      ? totalRequestedAmount.dividedBy(activeLoansCount).toDecimalPlaces(2)
      : new Decimal(0)

    return {
      recoveryRate,
      averageTicket,
      activeLoansCount,
      finishedLoansCount,
    }
  }

  async getBadDebtByMonth(year: number, month: number): Promise<BadDebtData[]> {
    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0, 23, 59, 59)

    const loans = await this.prisma.loan.findMany({
      where: {
        badDebtDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        pendingAmountStored: true,
        snapshotRouteId: true,
        snapshotRouteName: true,
      },
    })

    // Group by route
    const byRoute = new Map<string, { routeName: string; count: number; amount: Decimal }>()

    for (const loan of loans) {
      const routeId = loan.snapshotRouteId || 'unknown'
      const routeName = loan.snapshotRouteName || 'Sin ruta'

      if (!byRoute.has(routeId)) {
        byRoute.set(routeId, { routeName, count: 0, amount: new Decimal(0) })
      }

      const data = byRoute.get(routeId)!
      data.count++
      data.amount = data.amount.plus(new Decimal(loan.pendingAmountStored.toString()))
    }

    return Array.from(byRoute.entries()).map(([routeId, data]) => ({
      routeId,
      routeName: data.routeName,
      loanCount: data.count,
      totalAmount: data.amount,
    }))
  }

  async getBadDebtSummary(): Promise<BadDebtSummary> {
    const loans = await this.prisma.loan.findMany({
      where: {
        badDebtDate: { not: null },
      },
      select: {
        id: true,
        pendingAmountStored: true,
        snapshotRouteId: true,
        snapshotRouteName: true,
      },
    })

    // Group by route
    const byRoute = new Map<string, { routeName: string; count: number; amount: Decimal }>()

    let totalLoans = 0
    let totalAmount = new Decimal(0)

    for (const loan of loans) {
      const routeId = loan.snapshotRouteId || 'unknown'
      const routeName = loan.snapshotRouteName || 'Sin ruta'

      if (!byRoute.has(routeId)) {
        byRoute.set(routeId, { routeName, count: 0, amount: new Decimal(0) })
      }

      const data = byRoute.get(routeId)!
      data.count++
      data.amount = data.amount.plus(new Decimal(loan.pendingAmountStored.toString()))

      totalLoans++
      totalAmount = totalAmount.plus(new Decimal(loan.pendingAmountStored.toString()))
    }

    const byRouteArray: BadDebtData[] = Array.from(byRoute.entries()).map(
      ([routeId, data]) => ({
        routeId,
        routeName: data.routeName,
        loanCount: data.count,
        totalAmount: data.amount,
      })
    )

    return {
      totalLoans,
      totalAmount,
      byRoute: byRouteArray,
    }
  }

  // Helper function to check if a date is in a complete week
  private isDateInCompleteWeek(date: Date, year: number, month: number): boolean {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const firstDay = new Date(year, month - 1, 1)
    const lastDay = new Date(year, month, 0)

    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month - 1
    const cutoffDate = isCurrentMonth ? today : lastDay

    const dateToCheck = new Date(date)
    dateToCheck.setHours(0, 0, 0, 0)

    if (dateToCheck > cutoffDate) return false

    const dayOfWeek = dateToCheck.getDay()
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const weekMonday = new Date(dateToCheck)
    weekMonday.setDate(dateToCheck.getDate() + daysToMonday)

    const weekSunday = new Date(weekMonday)
    weekSunday.setDate(weekMonday.getDate() + 6)
    weekSunday.setHours(23, 59, 59, 999)

    if (weekSunday > cutoffDate) return false

    const weekStart = weekMonday > firstDay ? weekMonday : firstDay
    const weekEnd = weekSunday < lastDay ? weekSunday : lastDay

    let workingDays = 0
    for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay()
      if (dow >= 1 && dow <= 5) workingDays++
    }

    return workingDays >= 5
  }

  // Helper to calculate active weeks info
  private getActiveWeeksInfo(year: number, month: number): {
    activeWeeks: number
    workingDaysInCompleteWeeks: number
    totalWorkingDays: number
    adjustmentFactor: number
  } {
    const firstDay = new Date(year, month - 1, 1)
    const lastDay = new Date(year, month, 0)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month - 1
    const cutoffDate = isCurrentMonth ? today : lastDay

    let activeWeeks = 0
    let workingDaysInCompleteWeeks = 0

    let totalWorkingDays = 0
    for (let d = new Date(firstDay); d <= lastDay && d <= cutoffDate; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay()
      if (dow >= 1 && dow <= 5) totalWorkingDays++
    }

    let currentMonday = new Date(firstDay)
    const firstDayOfWeek = firstDay.getDay()

    if (firstDayOfWeek !== 1) {
      const daysToAdd = firstDayOfWeek === 0 ? 1 : 8 - firstDayOfWeek
      currentMonday = new Date(year, month - 1, 1 + daysToAdd)
    }

    while (currentMonday <= lastDay) {
      const weekSunday = new Date(currentMonday)
      weekSunday.setDate(weekSunday.getDate() + 6)
      weekSunday.setHours(23, 59, 59, 999)

      if (weekSunday > cutoffDate) break

      const weekStart = currentMonday > firstDay ? currentMonday : firstDay
      const weekEnd = weekSunday < lastDay ? weekSunday : lastDay

      let workingDays = 0
      for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay()
        if (dow >= 1 && dow <= 5) workingDays++
      }

      if (workingDays >= 5) {
        activeWeeks++
        workingDaysInCompleteWeeks += workingDays
      }

      currentMonday.setDate(currentMonday.getDate() + 7)
    }

    const adjustmentFactor = totalWorkingDays > 0
      ? workingDaysInCompleteWeeks / totalWorkingDays
      : 1

    return { activeWeeks, workingDaysInCompleteWeeks, totalWorkingDays, adjustmentFactor }
  }

  async getFinancialReportAnnual(routeIds: string[], year: number) {
    // Get routes info
    const routes = await this.prisma.route.findMany({
      where: { id: { in: routeIds } },
      select: { id: true, name: true }
    })

    if (routes.length === 0) {
      throw new Error('No se encontraron rutas')
    }

    const yearStart = new Date(`${year}-01-01`)
    const yearEnd = new Date(`${year}-12-31T23:59:59.999Z`)

    // Get all account entries for the year
    // Filter by snapshotRouteId OR by the associated loan's lead routes
    const entries = await this.prisma.accountEntry.findMany({
      where: {
        entryDate: { gte: yearStart, lte: yearEnd },
        OR: [
          { snapshotRouteId: { in: routeIds } },
          {
            loan: {
              leadRelation: {
                routes: {
                  some: { id: { in: routeIds } },
                },
              },
            },
          },
        ],
      },
      select: {
        amount: true,
        entryType: true,
        sourceType: true,
        entryDate: true,
        accountId: true,
        profitAmount: true,
      }
    })

    // Get loans
    // Note: We need ALL payments (not filtered by year) to correctly calculate badDebtAmount
    // The badDebt calculation needs payments from previous years that were made before badDebtDate
    const loans = await this.prisma.loan.findMany({
      where: {
        AND: [
          { signDate: { lt: yearEnd } },
          {
            OR: [
              { finishedDate: null },
              { finishedDate: { gte: yearStart } }
            ],
          },
          this.getRouteFilterCondition(routeIds),
        ],
      },
      select: {
        id: true,
        signDate: true,
        finishedDate: true,
        badDebtDate: true,
        amountGived: true,
        profitAmount: true,
        previousLoan: true,
        payments: {
          // Get ALL payments - needed for badDebt calculation which requires payments from any year
          select: {
            amount: true,
            receivedAt: true,
          }
        }
      }
    })

    // Get gas accounts
    const gasolineAccounts = await this.prisma.account.findMany({
      where: {
        OR: [
          { type: 'PREPAID_GAS' },
          { type: 'OFFICE_CASH_FUND' },
          { type: 'EMPLOYEE_CASH_FUND' }
        ]
      },
      select: { id: true, type: true }
    })

    const tokaAccountId = gasolineAccounts.find(acc => acc.type === 'PREPAID_GAS')?.id
    const cashAccountIds = gasolineAccounts
      .filter(acc => acc.type === 'OFFICE_CASH_FUND' || acc.type === 'EMPLOYEE_CASH_FUND')
      .map(acc => acc.id)

    // Initialize monthly data
    const monthlyData: Record<string, any> = {}
    const weeklyData: Record<string, { profit: number; expenses: number; income: number; badDebt: number }> = {}

    for (let month = 1; month <= 12; month++) {
      const monthKey = month.toString().padStart(2, '0')
      monthlyData[monthKey] = {
        totalExpenses: new Decimal(0),
        generalExpenses: new Decimal(0),
        nomina: new Decimal(0),
        comissions: new Decimal(0),
        incomes: new Decimal(0),
        loanDisbursements: new Decimal(0),
        carteraActiva: 0,
        carteraVencida: 0,
        renovados: 0,
        badDebtAmount: new Decimal(0),
        badDebtCapital: new Decimal(0),
        badDebtProfit: new Decimal(0),
        totalIncomingCash: new Decimal(0),
        capitalReturn: new Decimal(0),
        profitReturn: new Decimal(0),
        operationalCashUsed: new Decimal(0),
        totalInvestment: new Decimal(0),
        tokaGasolina: new Decimal(0),
        cashGasolina: new Decimal(0),
        totalGasolina: new Decimal(0),
        operationalExpenses: new Decimal(0),
        availableCash: new Decimal(0),
        travelExpenses: new Decimal(0),
        paymentsCount: 0,
        gainPerPayment: new Decimal(0),
        operationalProfit: new Decimal(0),
        profitPercentage: new Decimal(0),
        operationalProfitCapitalOnly: new Decimal(0),
        assetAcquisitions: new Decimal(0),
        netProfit: new Decimal(0),
        carteraMuerta: new Decimal(0),
        nominaInterna: new Decimal(0),
        salarioExterno: new Decimal(0),
        viaticos: new Decimal(0),
        activeWeeks: 0,
        weeklyAverageProfit: new Decimal(0),
        weeklyAverageExpenses: new Decimal(0),
        weeklyAverageIncome: new Decimal(0),
        totalCash: new Decimal(0),
      }
      weeklyData[monthKey] = { profit: 0, expenses: 0, income: 0, badDebt: 0 }
    }


    // Process account entries
    for (const entry of entries) {
      const entryDate = entry.entryDate ? new Date(entry.entryDate) : new Date()
      const month = entryDate.getMonth() + 1
      const monthKey = month.toString().padStart(2, '0')

      const amount = new Decimal(entry.amount?.toString() || '0')
      const monthData = monthlyData[monthKey]

      if (entry.entryType === 'DEBIT') {
        // DEBIT entries are expenses/outflows
        if (entry.sourceType === 'GASOLINE' || entry.sourceType === 'GASOLINE_TOKA') {
          if (entry.accountId === tokaAccountId) {
            monthData.tokaGasolina = monthData.tokaGasolina.plus(amount)
          } else if (cashAccountIds.includes(entry.accountId || '')) {
            monthData.cashGasolina = monthData.cashGasolina.plus(amount)
          }
          monthData.totalGasolina = monthData.totalGasolina.plus(amount)
          monthData.generalExpenses = monthData.generalExpenses.plus(amount)
        } else {
          switch (entry.sourceType) {
            case 'NOMINA_SALARY':
              monthData.nominaInterna = monthData.nominaInterna.plus(amount)
              monthData.nomina = monthData.nomina.plus(amount)
              monthData.operationalExpenses = monthData.operationalExpenses.plus(amount)
              break
            case 'EXTERNAL_SALARY':
              monthData.salarioExterno = monthData.salarioExterno.plus(amount)
              monthData.nomina = monthData.nomina.plus(amount)
              monthData.operationalExpenses = monthData.operationalExpenses.plus(amount)
              break
            case 'VIATIC':
              monthData.viaticos = monthData.viaticos.plus(amount)
              monthData.nomina = monthData.nomina.plus(amount)
              monthData.operationalExpenses = monthData.operationalExpenses.plus(amount)
              break
            case 'TRAVEL_EXPENSES':
              monthData.travelExpenses = monthData.travelExpenses.plus(amount)
              monthData.operationalExpenses = monthData.operationalExpenses.plus(amount)
              break
            case 'PAYMENT_COMMISSION':
            case 'LOAN_GRANT_COMMISSION':
              monthData.comissions = monthData.comissions.plus(amount)
              monthData.operationalExpenses = monthData.operationalExpenses.plus(amount)
              break
            case 'LOAN_GRANT':
              monthData.loanDisbursements = monthData.loanDisbursements.plus(amount)
              break
            case 'TRANSFER_OUT':
              // Skip transfers - they don't affect operational metrics
              break
            // Otros gastos operativos (mapeados de legacy expenseSource)
            case 'EMPLOYEE_EXPENSE':
            case 'GENERAL_EXPENSE':
            case 'CAR_PAYMENT':
            case 'BANK_EXPENSE':
            case 'OTHER_EXPENSE':
              monthData.generalExpenses = monthData.generalExpenses.plus(amount)
              monthData.operationalExpenses = monthData.operationalExpenses.plus(amount)
              break
            case 'BALANCE_ADJUSTMENT':
              // BALANCE_ADJUSTMENT es solo para reconciliación, no afecta métricas operativas
              break
            case 'ASSET_ACQUISITION':
              // Adquisición de activos (vehículos, equipos) - NO afecta ganancia operativa
              // Se registra aparte para calcular netProfit
              monthData.assetAcquisitions = monthData.assetAcquisitions.plus(amount)
              break
            default:
              // Solo para tipos no mapeados (no debería ocurrir)
              monthData.generalExpenses = monthData.generalExpenses.plus(amount)
              monthData.operationalExpenses = monthData.operationalExpenses.plus(amount)
              break
          }
        }

        // Skip transfers and BALANCE_ADJUSTMENT for total calculations
        if (entry.sourceType !== 'TRANSFER_OUT' && entry.sourceType !== 'BALANCE_ADJUSTMENT') {
          monthData.totalExpenses = monthData.totalExpenses.plus(amount)
          monthData.totalCash = monthData.totalCash.minus(amount)

          // ASSET_ACQUISITION no es gasto operativo
          if (entry.sourceType !== 'ASSET_ACQUISITION') {
            monthData.operationalCashUsed = monthData.operationalCashUsed.plus(amount)

            if (entry.sourceType !== 'LOAN_GRANT') {
              monthData.totalInvestment = monthData.totalInvestment.plus(amount)
            }
          }
        }
      } else if (entry.entryType === 'CREDIT') {
        // CREDIT entries are incomes/inflows
        if (entry.sourceType === 'LOAN_PAYMENT_CASH' ||
            entry.sourceType === 'LOAN_PAYMENT_BANK') {
          monthData.totalIncomingCash = monthData.totalIncomingCash.plus(amount)
          const profit = new Decimal(entry.profitAmount?.toString() || '0')
          monthData.profitReturn = monthData.profitReturn.plus(profit)
          monthData.incomes = monthData.incomes.plus(profit)
          monthData.capitalReturn = monthData.capitalReturn.plus(amount.minus(profit))
          monthData.paymentsCount += 1
        } else if (entry.sourceType === 'EXPENSE_REFUND') {
          // Devoluciones reducen gastos operativos (ej: DEVOLUCION DE FIANZA)
          monthData.generalExpenses = monthData.generalExpenses.minus(amount)
          monthData.operationalExpenses = monthData.operationalExpenses.minus(amount)
          monthData.totalCash = monthData.totalCash.plus(amount)
        } else if (entry.sourceType === 'BALANCE_ADJUSTMENT') {
          // BALANCE_ADJUSTMENT CREDIT es solo para reconciliación
          // Solo afecta el balance de caja, no métricas operativas
          monthData.totalCash = monthData.totalCash.plus(amount)
        } else if (entry.sourceType !== 'TRANSFER_IN') {
          // Skip transfers for income calculations
          monthData.incomes = monthData.incomes.plus(amount)
          monthData.totalIncomingCash = monthData.totalIncomingCash.plus(amount)
          monthData.profitReturn = monthData.profitReturn.plus(amount)
          monthData.totalCash = monthData.totalCash.plus(amount)
        } else {
          // TRANSFER_IN - solo afecta caja
          monthData.totalCash = monthData.totalCash.plus(amount)
        }
      }
    }

    // Process weekly data for averages
    for (const entry of entries) {
      const entryDate = entry.entryDate ? new Date(entry.entryDate) : new Date()
      const month = entryDate.getMonth() + 1
      const monthKey = month.toString().padStart(2, '0')

      if (!this.isDateInCompleteWeek(entryDate, year, month)) continue

      const amount = Number(entry.amount || 0)
      const weekData = weeklyData[monthKey]

      if (entry.entryType === 'DEBIT') {
        // Skip LOAN_GRANT, transfers, and BALANCE_ADJUSTMENT for expense calculations
        if (entry.sourceType !== 'LOAN_GRANT' &&
            entry.sourceType !== 'TRANSFER_OUT' &&
            entry.sourceType !== 'BALANCE_ADJUSTMENT') {
          weekData.expenses += amount
        }
      } else if (entry.entryType === 'CREDIT') {
        // Skip transfers for income calculations
        if (entry.sourceType === 'LOAN_PAYMENT_CASH' ||
            entry.sourceType === 'LOAN_PAYMENT_BANK') {
          const profit = Number(entry.profitAmount || 0)
          weekData.income += profit
        } else if (entry.sourceType === 'EXPENSE_REFUND') {
          // Devoluciones reducen gastos
          weekData.expenses -= amount
        } else if (entry.sourceType !== 'TRANSFER_IN' && entry.sourceType !== 'BALANCE_ADJUSTMENT') {
          weekData.income += amount
        }
      }
    }

    // Process loans for portfolio metrics
    const loanMetrics = loans.map(loan => {
      const signDate = new Date(loan.signDate)
      const finishedDate = loan.finishedDate ? new Date(loan.finishedDate) : null
      const badDebtDate = loan.badDebtDate ? new Date(loan.badDebtDate) : null
      const amountGived = Number(loan.amountGived || 0)
      const profitAmount = Number(loan.profitAmount || 0)
      const totalToPay = amountGived + profitAmount

      // All payments sorted by date - needed for badDebt calculation
      const paymentsByDate = (loan.payments || []).map(payment => ({
        amount: Number(payment.amount || 0),
        date: new Date(payment.receivedAt || new Date())
      })).sort((a, b) => a.date.getTime() - b.date.getTime())

      // Payments grouped by month - ONLY for the current year
      // This is used for carteraVencida calculation (hasPaymentInMonth check)
      const paymentsByMonth = new Map<number, typeof paymentsByDate>()
      paymentsByDate.forEach(payment => {
        // Only include payments from the current year for month grouping
        if (payment.date.getFullYear() === year) {
          const month = payment.date.getMonth() + 1
          if (!paymentsByMonth.has(month)) {
            paymentsByMonth.set(month, [])
          }
          paymentsByMonth.get(month)!.push(payment)
        }
      })

      return {
        signDate,
        finishedDate,
        badDebtDate,
        amountGived,
        profitAmount,
        totalToPay,
        previousLoan: loan.previousLoan,
        paymentsByDate,
        paymentsByMonth
      }
    })

    // Process bad debt for weekly data
    for (const loan of loanMetrics) {
      if (loan.badDebtDate) {
        const badDebtMonth = loan.badDebtDate.getMonth() + 1
        const monthKey = badDebtMonth.toString().padStart(2, '0')

        if (this.isDateInCompleteWeek(loan.badDebtDate, year, badDebtMonth)) {
          let totalPaid = 0
          for (const payment of loan.paymentsByDate) {
            if (payment.date <= loan.badDebtDate) {
              totalPaid += payment.amount
            } else {
              break
            }
          }
          const badDebtAmount = loan.totalToPay - totalPaid
          weeklyData[monthKey].badDebt += badDebtAmount
        }
      }
    }

    // Calculate portfolio metrics and final values per month
    let cumulativeCashBalance = 0

    for (let month = 1; month <= 12; month++) {
      const monthKey = month.toString().padStart(2, '0')
      const monthStart = new Date(year, month - 1, 1)
      const monthEnd = new Date(year, month, 0, 23, 59, 59, 999)

      const monthCashFlow = Number(monthlyData[monthKey].totalCash.toString())
      cumulativeCashBalance += monthCashFlow
      monthlyData[monthKey].availableCash = new Decimal(Math.max(0, cumulativeCashBalance))

      let activeLoans = 0
      let overdueLoans = 0
      let renewedLoans = 0
      let badDebtAmount = new Decimal(0)
      let badDebtCapital = new Decimal(0)
      let carteraMuertaTotal = new Decimal(0)

      for (const loan of loanMetrics) {
        if (loan.signDate > monthEnd) continue

        const isActive = !loan.finishedDate || loan.finishedDate > monthEnd

        if (isActive) {
          activeLoans++
          const hasPaymentInMonth = loan.paymentsByMonth.has(month)
          if (!hasPaymentInMonth && loan.badDebtDate && loan.badDebtDate <= monthEnd) {
            overdueLoans++
          }
        }

        if (loan.badDebtDate) {
          if (loan.badDebtDate >= monthStart && loan.badDebtDate <= monthEnd) {
            let totalPaid = 0
            let gananciaCobradaEnBadDebt = 0
            for (const payment of loan.paymentsByDate) {
              if (payment.date <= loan.badDebtDate) {
                totalPaid += payment.amount
                // Proporción de ganancia cobrada en cada pago
                gananciaCobradaEnBadDebt += payment.amount * (loan.profitAmount / loan.totalToPay)
              } else break
            }
            const pendingDebt = Math.max(0, loan.totalToPay - totalPaid)
            const gananciaPendiente = Math.max(0, loan.profitAmount - gananciaCobradaEnBadDebt)
            const capitalPendiente = Math.max(0, pendingDebt - gananciaPendiente)

            badDebtAmount = badDebtAmount.plus(pendingDebt)
            badDebtCapital = badDebtCapital.plus(capitalPendiente)
          }

          if (loan.badDebtDate <= monthEnd) {
            let totalPaid = 0
            let gananciaCobrada = 0
            for (const payment of loan.paymentsByDate) {
              if (payment.date <= loan.badDebtDate) {
                totalPaid += payment.amount
                gananciaCobrada += payment.amount * (loan.profitAmount / loan.totalToPay)
              } else break
            }
            const deudaPendiente = loan.totalToPay - totalPaid
            const gananciaPendiente = loan.profitAmount - gananciaCobrada
            const carteraMuerta = deudaPendiente - gananciaPendiente
            carteraMuertaTotal = carteraMuertaTotal.plus(Math.max(0, carteraMuerta))
          }
        }

        if (loan.previousLoan && loan.signDate >= monthStart && loan.signDate <= monthEnd) {
          renewedLoans++
        }
      }

      monthlyData[monthKey].carteraActiva = activeLoans
      monthlyData[monthKey].carteraVencida = overdueLoans
      monthlyData[monthKey].carteraMuerta = carteraMuertaTotal
      monthlyData[monthKey].renovados = renewedLoans
      monthlyData[monthKey].badDebtAmount = badDebtAmount
      monthlyData[monthKey].badDebtCapital = badDebtCapital
      monthlyData[monthKey].badDebtProfit = badDebtAmount.minus(badDebtCapital)

      // Calculate active weeks info
      const weeksInfo = this.getActiveWeeksInfo(year, month)
      monthlyData[monthKey].activeWeeks = weeksInfo.activeWeeks

      // Calculate operational profit and percentage
      const data = monthlyData[monthKey]
      const uiExpensesTotal = data.generalExpenses.plus(data.nomina).plus(data.comissions).plus(data.badDebtAmount).plus(data.travelExpenses)
      const uiGainsTotal = data.incomes
      data.operationalProfit = uiGainsTotal.minus(uiExpensesTotal)
      // netProfit = ganancia operativa - adquisiciones de activos (flujo de caja real)
      data.netProfit = data.operationalProfit.minus(data.assetAcquisitions)
      data.profitPercentage = uiGainsTotal.greaterThan(0)
        ? data.operationalProfit.dividedBy(uiGainsTotal).times(100)
        : new Decimal(0)
      data.gainPerPayment = data.paymentsCount > 0
        ? data.operationalProfit.dividedBy(data.paymentsCount)
        : new Decimal(0)

      // Calculate operational profit considering only capital (not profit) from bad debt
      const uiExpensesTotalCapitalOnly = data.generalExpenses.plus(data.nomina).plus(data.comissions).plus(data.badDebtCapital).plus(data.travelExpenses)
      data.operationalProfitCapitalOnly = uiGainsTotal.minus(uiExpensesTotalCapitalOnly)

      // Calculate weekly averages
      const activeWeeks = weeksInfo.activeWeeks
      const weekData = weeklyData[monthKey]
      const weeklyExpensesTotal = weekData.expenses + weekData.badDebt
      const weeklyProfit = weekData.income - weeklyExpensesTotal

      data.weeklyAverageProfit = new Decimal(activeWeeks > 0 ? weeklyProfit / activeWeeks : 0)
      data.weeklyAverageExpenses = new Decimal(activeWeeks > 0 ? weeklyExpensesTotal / activeWeeks : 0)
      data.weeklyAverageIncome = new Decimal(activeWeeks > 0 ? weekData.income / activeWeeks : 0)
    }

    // Calculate annual weekly averages
    let totalActiveWeeks = 0
    let totalWeeklyProfit = 0
    let totalWeeklyExpenses = 0
    let totalWeeklyIncome = 0

    for (let month = 1; month <= 12; month++) {
      const monthKey = month.toString().padStart(2, '0')
      const weekData = weeklyData[monthKey]
      const activeWeeks = monthlyData[monthKey].activeWeeks

      const weeklyExpensesTotal = weekData.expenses + weekData.badDebt
      const weeklyProfit = weekData.income - weeklyExpensesTotal

      totalWeeklyProfit += weeklyProfit
      totalWeeklyExpenses += weeklyExpensesTotal
      totalWeeklyIncome += weekData.income
      totalActiveWeeks += activeWeeks
    }

    const annualWeeklyAverageProfit = totalActiveWeeks > 0 ? totalWeeklyProfit / totalActiveWeeks : 0
    const annualWeeklyAverageExpenses = totalActiveWeeks > 0 ? totalWeeklyExpenses / totalActiveWeeks : 0
    const annualWeeklyAverageIncome = totalActiveWeeks > 0 ? totalWeeklyIncome / totalActiveWeeks : 0

    // Convert monthly data to array format
    const monthNames = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
      'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

    const dataArray = monthNames.map((name, index) => {
      const monthKey = (index + 1).toString().padStart(2, '0')
      const data = monthlyData[monthKey]
      return {
        month: monthKey,
        totalExpenses: data.totalExpenses,
        generalExpenses: data.generalExpenses,
        nomina: data.nomina,
        comissions: data.comissions,
        nominaInterna: data.nominaInterna,
        salarioExterno: data.salarioExterno,
        viaticos: data.viaticos,
        travelExpenses: data.travelExpenses,
        tokaGasolina: data.tokaGasolina,
        cashGasolina: data.cashGasolina,
        totalGasolina: data.totalGasolina,
        badDebtAmount: data.badDebtAmount || new Decimal(0),
        badDebtCapital: data.badDebtCapital || new Decimal(0),
        badDebtProfit: data.badDebtProfit || new Decimal(0),
        incomes: data.incomes,
        operationalProfit: data.operationalProfit,
        operationalProfitCapitalOnly: data.operationalProfitCapitalOnly || data.operationalProfit,
        assetAcquisitions: data.assetAcquisitions || new Decimal(0),
        netProfit: data.netProfit || data.operationalProfit,
        profitPercentage: data.profitPercentage,
        gainPerPayment: data.gainPerPayment,
        activeWeeks: data.activeWeeks,
        weeklyAverageProfit: data.weeklyAverageProfit,
        weeklyAverageExpenses: data.weeklyAverageExpenses,
        weeklyAverageIncome: data.weeklyAverageIncome,
        loanDisbursements: data.loanDisbursements,
        carteraActiva: data.carteraActiva,
        carteraVencida: data.carteraVencida,
        carteraMuerta: data.carteraMuerta,
        renovados: data.renovados,
        totalIncomingCash: data.totalIncomingCash,
        capitalReturn: data.capitalReturn,
        profitReturn: data.profitReturn,
        operationalCashUsed: data.operationalCashUsed,
        totalInvestment: data.totalInvestment,
        availableCash: data.availableCash,
        paymentsCount: data.paymentsCount,
      }
    })

    return {
      routes: routes.map(route => ({ id: route.id, name: route.name })),
      year,
      months: monthNames,
      data: dataArray,
      annualWeeklyAverageProfit: new Decimal(annualWeeklyAverageProfit),
      annualWeeklyAverageExpenses: new Decimal(annualWeeklyAverageExpenses),
      annualWeeklyAverageIncome: new Decimal(annualWeeklyAverageIncome),
      totalActiveWeeks,
    }
  }
}
