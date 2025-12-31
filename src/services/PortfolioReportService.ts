import { Decimal } from 'decimal.js'
import type { PrismaClient, Loan, LoanPayment } from '@solufacil/database'
import {
  getActiveWeekRange,
  getWeeksInMonth,
  getPreviousWeek,
  isInCarteraVencida,
  calculateClientBalance,
  calculateRenovationKPIs,
  countClientsStatus,
  countActiveLoansAtDate,
  isLoanConsideredOnDate,
  calculateCVContribution,
  buildRenewalMap,
  type WeekRange,
  type LoanForPortfolio,
  type PaymentForCV,
  type PortfolioReport,
  type PortfolioSummary,
  type WeeklyPortfolioData,
  type LocationBreakdown,
  type RenovationKPIs,
  type ActiveClientStatus,
  type CVStatus,
  type PeriodType,
  type LocalityReport,
  type LocalityBreakdown as LocalityBreakdownType,
  type LocalityWeekData,
  type LocalitySummary,
  type LocalityClientDetail,
  type ClientCategory,
} from '@solufacil/business-logic'

export interface PortfolioFilters {
  locationIds?: string[]
  routeIds?: string[]
  loantypeIds?: string[]
}

export class PortfolioReportService {
  constructor(private prisma: PrismaClient) {}

  // ========== Helper Methods for Building Queries ==========

  /**
   * Builds the base WHERE clause for querying active loans.
   * An active loan is one that:
   * - Has pending amount > 0
   * - Is not marked as bad debt
   * - Is not excluded by cleanup
   * - Has not been renewed (renewedDate is null)
   * - Has not been finished (finishedDate is null)
   *
   * @param filters - Optional filters for routes, loan types, and locations
   * @param options - Configuration options for the where clause
   * @returns Prisma-compatible where clause object
   */
  private buildActiveLoansWhereClause(
    filters?: PortfolioFilters,
    options: {
      /** Use OR condition for route filtering (snapshotRouteId OR lead's routes) */
      useRouteOrCondition?: boolean
      /** Include location filter based on borrower's address */
      includeLocationFilter?: boolean
    } = {}
  ): Record<string, unknown> {
    const { useRouteOrCondition = true, includeLocationFilter = false } = options

    const whereClause: Record<string, unknown> = {
      pendingAmountStored: { gt: 0 },
      badDebtDate: null,
      excludedByCleanup: null,
      renewedDate: null,
      finishedDate: null,
    }

    // Apply route filter
    if (filters?.routeIds?.length) {
      if (useRouteOrCondition) {
        // Include loans matching snapshotRouteId OR lead's assigned routes
        whereClause.OR = [
          { snapshotRouteId: { in: filters.routeIds } },
          {
            leadRelation: {
              routes: {
                some: { id: { in: filters.routeIds } },
              },
            },
          },
        ]
      } else {
        // Simple filter by snapshotRouteId only
        whereClause.snapshotRouteId = { in: filters.routeIds }
      }
    }

    // Apply loan type filter
    if (filters?.loantypeIds?.length) {
      whereClause.loantype = { in: filters.loantypeIds }
    }

    // Apply location filter (based on borrower's address)
    if (includeLocationFilter && filters?.locationIds?.length) {
      whereClause.borrowerRelation = {
        personalDataRelation: {
          addresses: {
            some: { location: { in: filters.locationIds } },
          },
        },
      }
    }

    return whereClause
  }

  // ========== Public Methods ==========

  /**
   * Gets the current active week range
   */
  getCurrentActiveWeek(): WeekRange {
    return getActiveWeekRange(new Date())
  }

  /**
   * Checks if a week is completed (the Sunday has passed)
   *
   * @param week - The week to check
   * @returns true if the week is complete (we're past Sunday 23:59:59)
   */
  private isWeekCompleted(week: WeekRange): boolean {
    const now = new Date()
    return now > week.end
  }

  /**
   * Gets only the completed weeks from an array of weeks
   * A week is completed when the current date is past the week's end (Sunday 23:59:59)
   *
   * @param weeks - Array of weeks to filter
   * @returns Only the weeks that have been completed
   */
  private getCompletedWeeks(weeks: WeekRange[]): WeekRange[] {
    return weeks.filter((week) => this.isWeekCompleted(week))
  }

  /**
   * Gets the last completed week for CV calculation
   * If no weeks are completed yet, returns null
   *
   * @param weeks - Array of weeks in the period
   * @returns The last completed week, or null if none are completed
   */
  private getLastCompletedWeek(weeks: WeekRange[]): WeekRange | null {
    const completedWeeks = this.getCompletedWeeks(weeks)
    if (completedWeeks.length === 0) {
      return null
    }
    return completedWeeks[completedWeeks.length - 1]
  }

  /**
   * Gets a weekly portfolio report
   */
  async getWeeklyReport(
    year: number,
    weekNumber: number,
    filters?: PortfolioFilters
  ): Promise<PortfolioReport> {
    const targetDate = this.getDateFromWeekNumber(year, weekNumber)
    const activeWeek = getActiveWeekRange(targetDate)
    const previousWeek = getPreviousWeek(activeWeek)

    const { loans, paymentsMap } = await this.getActiveLoansWithPayments(
      activeWeek,
      filters
    )

    const summary = await this.calculateSummary(
      loans,
      paymentsMap,
      activeWeek,
      previousWeek,
      activeWeek.start,
      activeWeek.end
    )

    const weeklyData: WeeklyPortfolioData[] = [
      {
        weekRange: activeWeek,
        clientesActivos: summary.totalClientesActivos,
        clientesEnCV: summary.clientesEnCV,
        balance: summary.clientBalance.balance,
        isCompleted: this.isWeekCompleted(activeWeek),
      },
    ]

    const byLocation = await this.getRouteBreakdown(
      loans,
      paymentsMap,
      activeWeek,
      filters
    )

    const renovationKPIs = await this.getRenovationKPIs(
      activeWeek.start,
      activeWeek.end,
      filters
    )

    return {
      reportDate: new Date(),
      periodType: 'WEEKLY' as PeriodType,
      year,
      weekNumber,
      summary,
      weeklyData,
      byLocation,
      renovationKPIs,
    }
  }

  /**
   * Gets a monthly portfolio report
   *
   * CV is calculated as the AVERAGE of completed weeks only.
   * A week is "completed" when we're past Sunday 23:59:59.
   * If no weeks are completed yet, CV will be 0 and semanasCompletadas will be 0.
   */
  async getMonthlyReport(
    year: number,
    month: number,
    filters?: PortfolioFilters
  ): Promise<PortfolioReport> {
    const weeks = getWeeksInMonth(year, month - 1)

    if (weeks.length === 0) {
      throw new Error(`No weeks found for ${year}-${month}`)
    }

    const periodStart = weeks[0].start
    const periodEnd = weeks[weeks.length - 1].end

    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    const previousWeeks = getWeeksInMonth(prevYear, prevMonth - 1)
    const previousPeriodStart =
      previousWeeks.length > 0 ? previousWeeks[0].start : null
    const previousPeriodEnd =
      previousWeeks.length > 0
        ? previousWeeks[previousWeeks.length - 1].end
        : null

    // Get completed weeks for CV calculation
    const completedWeeks = this.getCompletedWeeks(weeks)
    const lastCompletedWeek = this.getLastCompletedWeek(weeks)
    const previousWeek = completedWeeks.length > 1 ? completedWeeks[completedWeeks.length - 2] : null

    // OPTIMIZATION: Run main query and renovation KPIs in parallel
    const [loansResult, renovationKPIs] = await Promise.all([
      this.getActiveLoansWithPaymentsForMonth(periodStart, periodEnd, filters),
      this.getRenovationKPIs(periodStart, periodEnd, filters),
    ])
    const { loans, allPayments, routeInfoMap } = loansResult

    // Build weekly data for ALL weeks (completed and not)
    // IMPORTANT: Pass ALL payments to countClientsStatus - it internally filters by week
    // This is needed for calculating surplus (overpayments from previous weeks)
    const weeklyData: WeeklyPortfolioData[] = []
    let totalCVFromCompletedWeeks = 0

    // Track per-route stats for each completed week (for calculating averages)
    const routeWeeklyStats = new Map<string, { alCorriente: number[], enCV: number[], lastWeekClientes: number, lastWeekAlCorriente: number, lastWeekCV: number }>()

    // Group loans by route once (for per-route calculations)
    const loansByRoute = new Map<string, LoanForPortfolio[]>()
    for (const loan of loans) {
      const routeInfo = routeInfoMap.get(loan.id)
      const routeId = routeInfo?.routeId || 'unknown'
      if (!loansByRoute.has(routeId)) {
        loansByRoute.set(routeId, [])
      }
      loansByRoute.get(routeId)!.push(loan)
    }

    for (const week of weeks) {
      const isCompleted = this.isWeekCompleted(week)

      // Use historical calculation for completed weeks (past weeks)
      // This uses date-based active status instead of current pendingAmountStored
      // Pass ALL payments - calculateCVContribution needs them for surplus calculation
      const weekStatus = countClientsStatus(loans, allPayments, week, isCompleted)
      const weekBalance = calculateClientBalance(
        loans,
        week.start,
        week.end
      )

      // Only count CV from completed weeks for the average
      if (isCompleted) {
        totalCVFromCompletedWeeks += weekStatus.enCV
      }

      // Calculate per-route stats for this week (for averages)
      if (isCompleted) {
        for (const [routeId, routeLoans] of loansByRoute) {
          const routePaymentsMap = new Map<string, PaymentForCV[]>()
          for (const loan of routeLoans) {
            routePaymentsMap.set(loan.id, allPayments.get(loan.id) || [])
          }
          const routeStatus = countClientsStatus(routeLoans, routePaymentsMap, week, true)

          if (!routeWeeklyStats.has(routeId)) {
            routeWeeklyStats.set(routeId, { alCorriente: [], enCV: [], lastWeekClientes: 0, lastWeekAlCorriente: 0, lastWeekCV: 0 })
          }
          const stats = routeWeeklyStats.get(routeId)!
          stats.alCorriente.push(routeStatus.alCorriente)
          stats.enCV.push(routeStatus.enCV)
          // Update last week values (will be the values from the last completed week)
          stats.lastWeekClientes = routeStatus.totalActivos
          stats.lastWeekAlCorriente = routeStatus.alCorriente
          stats.lastWeekCV = routeStatus.enCV
        }
      }

      weeklyData.push({
        weekRange: week,
        clientesActivos: weekStatus.totalActivos,
        clientesEnCV: isCompleted ? weekStatus.enCV : 0, // Only show CV for completed weeks
        balance: weekBalance.balance,
        isCompleted,
      })
    }

    // Use last completed week for route breakdown, or first week if none completed
    const weekForBreakdown = lastCompletedWeek || weeks[0]

    // Get route breakdown for display (kept for byLocation in response)
    const byLocation = await this.getRouteBreakdownWithAverages(
      loans,
      allPayments,
      weekForBreakdown,
      filters,
      routeInfoMap,
      routeWeeklyStats
    )

    // Call getRouteKPIs to get totals that match "Por Rutas" tab exactly
    // This sums per-route totals (same logic as the frontend displays)
    const routeKPIs = await this.getRouteKPIs(year, month, filters)
    const totalClientesActivos = routeKPIs.reduce((sum, r) => sum + r.clientesTotal, 0)
    const pagandoPromedio = routeKPIs.reduce((sum, r) => sum + r.pagandoPromedio, 0)
    const cvPromedio = routeKPIs.reduce((sum, r) => sum + r.cvPromedio, 0)

    // Calculate clients at the START of the period
    const startReferenceDate = new Date(periodStart.getTime() - 1)
    const clientesActivosInicio = countActiveLoansAtDate(loans, startReferenceDate)

    // Client balance for the period
    const clientBalance = calculateClientBalance(loans, periodStart, periodEnd)

    // Calculate comparison with previous period (approximate, from current loan data)
    // This avoids a second expensive getLocalityReport call
    let comparison = null
    if (previousPeriodStart && previousPeriodEnd && previousWeek) {
      const prevStatus = countClientsStatus(loans, allPayments, previousWeek, true)
      const prevBalance = calculateClientBalance(loans, previousPeriodStart, previousPeriodEnd)

      comparison = {
        previousPeriod: {
          clientesActivos: prevStatus.totalActivos,
          clientesEnCV: prevStatus.enCV,
          balance: prevBalance.balance,
        },
        cvChange: Math.round(cvPromedio) - prevStatus.enCV,
        balanceChange: clientBalance.balance - prevBalance.balance,
      }
    }

    const summary: PortfolioSummary = {
      clientesActivosInicio,
      totalClientesActivos,
      clientesAlCorriente: Math.round(pagandoPromedio),
      clientesEnCV: Math.round(cvPromedio),
      promedioCV: Math.round(cvPromedio * 100) / 100,
      semanasCompletadas: completedWeeks.length,
      totalSemanas: weeks.length,
      clientBalance,
      comparison,
    }

    // renovationKPIs already computed in parallel above

    return {
      reportDate: new Date(),
      periodType: 'MONTHLY' as PeriodType,
      year,
      month,
      summary,
      weeklyData,
      byLocation,
      renovationKPIs,
    }
  }

  /**
   * Gets simplified route KPIs - only 3 metrics per route:
   * - clientesTotal: Total active clients in the route (from last completed week)
   * - pagandoPromedio: Average clients "al corriente" across completed weeks
   * - cvPromedio: Average clients in CV across completed weeks
   *
   * This calls getLocalityReport for EACH route to ensure the KPIs match
   * exactly what the user sees when they click on a route card.
   */
  async getRouteKPIs(
    year: number,
    month: number,
    filters?: PortfolioFilters
  ): Promise<{ routeId: string; routeName: string; clientesTotal: number; pagandoPromedio: number; cvPromedio: number }[]> {
    // First, get all routes that have active loans
    const routes = await this.prisma.$queryRawUnsafe<Array<{
      id: string
      name: string
    }>>(`
      SELECT DISTINCT r.id, r.name
      FROM "Route" r
      WHERE EXISTS (
        SELECT 1 FROM "Loan" l
        JOIN "Employee" e ON l.lead = e.id
        JOIN "_RouteEmployees" re ON e.id = re."B"
        WHERE re."A" = r.id
          AND l."pendingAmountStored" > 0
          AND l."badDebtDate" IS NULL
          AND l."excludedByCleanup" IS NULL
          AND l."renewedDate" IS NULL
          AND l."finishedDate" IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM "Loan" l
        WHERE l."snapshotRouteId" = r.id
          AND l."pendingAmountStored" > 0
          AND l."badDebtDate" IS NULL
          AND l."excludedByCleanup" IS NULL
          AND l."renewedDate" IS NULL
          AND l."finishedDate" IS NULL
      )
      ORDER BY r.name
    `)

    if (routes.length === 0) {
      return []
    }

    // Call getLocalityReport for each route in parallel
    // This ensures the KPIs match exactly what's shown in drill-down
    const routeReports = await Promise.all(
      routes.map(async (route) => {
        const routeFilters: PortfolioFilters = {
          ...filters,
          routeIds: [route.id],
        }
        const report = await this.getLocalityReport(year, month, routeFilters)
        return {
          routeId: route.id,
          routeName: route.name,
          totals: report.totals,
        }
      })
    )

    // Build result from route reports
    const result: { routeId: string; routeName: string; clientesTotal: number; pagandoPromedio: number; cvPromedio: number }[] = []

    for (const routeReport of routeReports) {
      // Only include routes that have data
      if (routeReport.totals.totalClientesActivos > 0) {
        result.push({
          routeId: routeReport.routeId,
          routeName: routeReport.routeName,
          clientesTotal: routeReport.totals.totalClientesActivos,
          pagandoPromedio: Math.round(routeReport.totals.alCorrientePromedio * 100) / 100,
          cvPromedio: Math.round(routeReport.totals.cvPromedio * 100) / 100,
        })
      }
    }

    // Sort by clientesTotal descending
    return result.sort((a, b) => b.clientesTotal - a.clientesTotal)
  }

  /**
   * Gets active clients with their CV status
   * Uses the last completed week for CV calculation
   */
  async getActiveClientsWithCVStatus(
    filters?: PortfolioFilters
  ): Promise<ActiveClientStatus[]> {
    const currentWeek = getActiveWeekRange(new Date())
    // Use the previous week if current week is not completed
    // This ensures we have a full week of data for CV calculation
    const activeWeek = this.isWeekCompleted(currentWeek)
      ? currentWeek
      : getPreviousWeek(currentWeek)

    const whereClause = this.buildActiveLoansWhereClause(filters)

    const loans = await this.prisma.loan.findMany({
      where: whereClause,
      include: {
        payments: {
          where: {
            receivedAt: {
              gte: activeWeek.start,
              lte: activeWeek.end,
            },
          },
        },
        borrowerRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        snapshotRoute: true,
        leadRelation: {
          include: {
            routes: true,
          },
        },
      },
    })

    // Also get last payment for "days since last payment" calculation
    const loanIds = loans.map((l) => l.id)
    const lastPayments = await this.prisma.loanPayment.findMany({
      where: {
        loan: { in: loanIds },
      },
      orderBy: { receivedAt: 'desc' },
      distinct: ['loan'],
    })
    const lastPaymentMap = new Map(lastPayments.map((p) => [p.loan, p]))

    const result: ActiveClientStatus[] = []

    for (const loan of loans) {
      const loanForPortfolio = this.toLoanForPortfolio(loan)
      const payments = this.toPaymentsForCV(loan.payments)

      const inCV = isInCarteraVencida(loanForPortfolio, payments, activeWeek)
      const lastPayment = lastPaymentMap.get(loan.id)

      let daysSinceLastPayment: number | null = null
      if (lastPayment) {
        const diffTime = Date.now() - lastPayment.receivedAt.getTime()
        daysSinceLastPayment = Math.floor(diffTime / (1000 * 60 * 60 * 24))
      }

      // Get lead's routes (M:M relation) - take the first one
      const leadRoutes = loan.leadRelation?.routes || []
      const leadRoute = leadRoutes.length > 0 ? leadRoutes[0] : null

      // Get route using priority helper
      const { routeName } = this.getRoutePriority(loan, leadRoute)

      result.push({
        loanId: loan.id,
        borrowerId: loan.borrower,
        clientName:
          loan.borrowerRelation?.personalDataRelation?.fullName || 'N/A',
        pendingAmount: new Decimal(loan.pendingAmountStored).toNumber(),
        cvStatus: inCV ? ('EN_CV' as CVStatus) : ('AL_CORRIENTE' as CVStatus),
        daysSinceLastPayment,
        locationName: routeName,
        routeName: routeName,
      })
    }

    return result
  }

  /**
   * Gets a locality report with weekly breakdown
   * Groups loans by borrower's locality (from their address)
   */
  async getLocalityReport(
    year: number,
    month: number,
    filters?: PortfolioFilters
  ): Promise<LocalityReport> {
    const weeks = getWeeksInMonth(year, month - 1)

    if (weeks.length === 0) {
      throw new Error(`No weeks found for ${year}-${month}`)
    }

    // Map to store locality data: localityId -> { info, weeklyData[] }
    const localitiesMap = new Map<
      string,
      {
        localityId: string
        localityName: string
        routeId?: string
        routeName?: string
        weeklyDataMap: Map<number, LocalityWeekData>
      }
    >()

    // Process each week
    for (const week of weeks) {
      // Only calculate CV for completed weeks
      const isCompleted = this.isWeekCompleted(week)

      const loansWithLocality = await this.getLoansWithBorrowerLocality(
        week,
        filters
      )

      // Group loans by locality
      const loansByLocality = new Map<
        string,
        {
          localityId: string
          localityName: string
          routeId?: string
          routeName?: string
          loans: (LoanForPortfolio & { isNew: boolean; isRenewed: boolean; isReintegro: boolean; isFinished: boolean; isActive: boolean })[]
          paymentsMap: Map<string, PaymentForCV[]>
        }
      >()

      for (const loan of loansWithLocality) {
        const localityId = loan.localityId || 'sin-localidad'
        const localityName = loan.localityName || 'Sin Localidad'

        if (!loansByLocality.has(localityId)) {
          loansByLocality.set(localityId, {
            localityId,
            localityName,
            routeId: loan.routeId,
            routeName: loan.routeName,
            loans: [],
            paymentsMap: new Map(),
          })
        }

        const entry = loansByLocality.get(localityId)!
        entry.loans.push({
          id: loan.id,
          pendingAmountStored: loan.pendingAmountStored,
          signDate: loan.signDate,
          finishedDate: loan.finishedDate,
          renewedDate: loan.renewedDate,
          badDebtDate: loan.badDebtDate,
          excludedByCleanup: loan.excludedByCleanup,
          previousLoan: loan.previousLoan,
          // Fields needed for isLoanConsideredOnDate and CV calculation
          status: loan.status,
          rate: loan.rate,
          requestedAmount: loan.requestedAmount,
          totalPaid: loan.totalPaid,
          weekDuration: loan.weekDuration,
          totalDebt: loan.totalDebt,
          // Movement flags
          isNew: loan.isNew,
          isRenewed: loan.isRenewed,
          isReintegro: loan.isReintegro,
          isFinished: loan.isFinished,
          isActive: loan.isActive,
        })
        entry.paymentsMap.set(loan.id, loan.payments)
      }

      // Calculate metrics for each locality for this week
      for (const [localityId, data] of loansByLocality) {
        // Ensure locality exists in main map
        if (!localitiesMap.has(localityId)) {
          localitiesMap.set(localityId, {
            localityId: data.localityId,
            localityName: data.localityName,
            routeId: data.routeId,
            routeName: data.routeName,
            weeklyDataMap: new Map(),
          })
        }

        const localityEntry = localitiesMap.get(localityId)!

        // Filter only active loans for counting active clients and CV status
        const activeLoans = data.loans.filter((l) => l.isActive)
        const activeBaseLoanData = activeLoans.map((l) => ({
          id: l.id,
          pendingAmountStored: l.pendingAmountStored,
          signDate: l.signDate,
          finishedDate: l.finishedDate,
          renewedDate: l.renewedDate,
          badDebtDate: l.badDebtDate,
          excludedByCleanup: l.excludedByCleanup,
          previousLoan: l.previousLoan,
          // Campos necesarios para isLoanConsideredOnDate y CV calculation
          status: l.status,
          rate: l.rate,
          requestedAmount: l.requestedAmount,
          totalPaid: l.totalPaid,
          weekDuration: l.weekDuration,
          totalDebt: l.totalDebt,
        }))

        // Create payments map only for active loans
        const activePaymentsMap = new Map<string, PaymentForCV[]>()
        for (const loan of activeLoans) {
          activePaymentsMap.set(loan.id, data.paymentsMap.get(loan.id) || [])
        }

        // Use historical calculation for completed weeks
        const status = countClientsStatus(activeBaseLoanData, activePaymentsMap, week, isCompleted)
        const balance = calculateClientBalance(activeBaseLoanData, week.start, week.end)

        // Count movements (from all loans, not just active)
        const nuevos = data.loans.filter((l) => l.isNew).length
        const renovados = data.loans.filter((l) => l.isRenewed).length
        const reintegros = data.loans.filter((l) => l.isReintegro).length
        const finalizados = data.loans.filter((l) => l.isFinished).length

        // Only count CV for completed weeks
        const weekData: LocalityWeekData = {
          weekRange: week,
          clientesActivos: status.totalActivos,
          clientesAlCorriente: isCompleted ? status.alCorriente : status.totalActivos,
          clientesEnCV: isCompleted ? status.enCV : 0, // Only show CV for completed weeks
          nuevos,
          renovados,
          reintegros,
          finalizados,
          balance: balance.balance,
          isCompleted,
        }

        localityEntry.weeklyDataMap.set(week.weekNumber, weekData)
      }
    }

    // Build final localities array with summaries
    const localities: LocalityBreakdownType[] = []

    for (const [, localityData] of localitiesMap) {
      const weeklyData: LocalityWeekData[] = []

      // Fill in data for all weeks (some localities may not have loans in all weeks)
      for (const week of weeks) {
        const data = localityData.weeklyDataMap.get(week.weekNumber)
        if (data) {
          weeklyData.push(data)
        } else {
          // No data for this week means 0 clients
          weeklyData.push({
            weekRange: week,
            clientesActivos: 0,
            clientesAlCorriente: 0,
            clientesEnCV: 0,
            nuevos: 0,
            renovados: 0,
            reintegros: 0,
            finalizados: 0,
            balance: 0,
            isCompleted: this.isWeekCompleted(week),
          })
        }
      }

      // Calculate summary from weekly data
      // Find last completed week for summary values
      const completedWeeksData = weeklyData.filter((w) => w.isCompleted)
      const lastCompletedWeekData = completedWeeksData.length > 0
        ? completedWeeksData[completedWeeksData.length - 1]
        : null


      const totalNuevos = weeklyData.reduce((sum, w) => sum + w.nuevos, 0)
      const totalRenovados = weeklyData.reduce((sum, w) => sum + w.renovados, 0)
      const totalReintegros = weeklyData.reduce((sum, w) => sum + w.reintegros, 0)
      const totalFinalizados = weeklyData.reduce((sum, w) => sum + w.finalizados, 0)
      const totalBalance = weeklyData.reduce((sum, w) => sum + w.balance, 0)

      // Averages only from completed weeks (with null safety)
      const alCorrientePromedio =
        completedWeeksData.length > 0
          ? completedWeeksData.reduce((sum, w) => sum + (w.clientesAlCorriente ?? 0), 0) / completedWeeksData.length
          : 0

      const cvPromedio =
        completedWeeksData.length > 0
          ? completedWeeksData.reduce((sum, w) => sum + (w.clientesEnCV ?? 0), 0) / completedWeeksData.length
          : 0

      // Use last completed week for activos/alCorriente, or last week data if none completed
      // If weeklyData is empty, use a default object with zeros
      const summaryWeekData = lastCompletedWeekData || weeklyData[weeklyData.length - 1] || {
        clientesActivos: 0,
        clientesAlCorriente: 0,
        clientesEnCV: 0,
      }
      const porcentajePagando =
        summaryWeekData.clientesActivos > 0
          ? (summaryWeekData.clientesAlCorriente / summaryWeekData.clientesActivos) * 100
          : 0

      // Ensure all values are valid numbers (not NaN or undefined)
      const safeNumber = (val: number | undefined | null): number => {
        if (val === undefined || val === null || Number.isNaN(val)) return 0
        return val
      }

      const summary: LocalitySummary = {
        totalClientesActivos: safeNumber(summaryWeekData.clientesActivos),
        totalClientesAlCorriente: safeNumber(summaryWeekData.clientesAlCorriente),
        totalClientesEnCV: safeNumber(summaryWeekData.clientesEnCV), // Use last completed week's CV (consistent with detail modal)
        totalNuevos: safeNumber(totalNuevos),
        totalRenovados: safeNumber(totalRenovados),
        totalReintegros: safeNumber(totalReintegros),
        totalFinalizados: safeNumber(totalFinalizados),
        balance: safeNumber(totalBalance),
        alCorrientePromedio: safeNumber(alCorrientePromedio),
        cvPromedio: safeNumber(cvPromedio),
        porcentajePagando: safeNumber(porcentajePagando),
      }

      localities.push({
        localityId: localityData.localityId,
        localityName: localityData.localityName,
        routeId: localityData.routeId,
        routeName: localityData.routeName,
        weeklyData,
        summary,
      })
    }

    // Sort by total active clients descending
    localities.sort((a, b) => b.summary.totalClientesActivos - a.summary.totalClientesActivos)

    // Calculate global totals
    const totals: LocalitySummary = {
      totalClientesActivos: localities.reduce((sum, l) => sum + l.summary.totalClientesActivos, 0),
      totalClientesAlCorriente: localities.reduce((sum, l) => sum + l.summary.totalClientesAlCorriente, 0),
      totalClientesEnCV: localities.reduce((sum, l) => sum + l.summary.totalClientesEnCV, 0),
      totalNuevos: localities.reduce((sum, l) => sum + l.summary.totalNuevos, 0),
      totalRenovados: localities.reduce((sum, l) => sum + l.summary.totalRenovados, 0),
      totalReintegros: localities.reduce((sum, l) => sum + l.summary.totalReintegros, 0),
      totalFinalizados: localities.reduce((sum, l) => sum + l.summary.totalFinalizados, 0),
      balance: localities.reduce((sum, l) => sum + l.summary.balance, 0),
      // Sum all locality averages (represents total across all localities)
      alCorrientePromedio: localities.reduce((sum, l) => sum + l.summary.alCorrientePromedio, 0),
      cvPromedio: localities.reduce((sum, l) => sum + l.summary.cvPromedio, 0),
      porcentajePagando:
        localities.length > 0
          ? localities.reduce((sum, l) => sum + l.summary.porcentajePagando, 0) / localities.length
          : 0,
    }

    return {
      periodType: 'MONTHLY' as PeriodType,
      year,
      month,
      weeks,
      localities,
      totals,
    }
  }

  /**
   * Gets clients for a specific locality (for drill-down modal)
   *
   * IMPORTANT: Locality is determined by the LEAD's address, not the borrower's,
   * to be consistent with getLoansWithBorrowerLocality and portfolioByLocality.
   */
  async getLocalityClients(
    localityId: string,
    year: number,
    month: number,
    weekNumber?: number,
    category?: ClientCategory
  ): Promise<LocalityClientDetail[]> {
    const weeks = getWeeksInMonth(year, month - 1)
    if (weeks.length === 0) {
      return []
    }

    // Determine the week range to use
    // IMPORTANT: Use last COMPLETED week (consistent with getLocalityReport summary)
    // If a specific weekNumber is provided, use that week
    // Otherwise, use the last completed week (or last week if none completed)
    let targetWeek: WeekRange
    if (weekNumber) {
      targetWeek = weeks.find((w) => w.weekNumber === weekNumber) || weeks[weeks.length - 1]
    } else {
      const lastCompletedWeek = this.getLastCompletedWeek(weeks)
      targetWeek = lastCompletedWeek || weeks[weeks.length - 1]
    }

    // Query loans filtering by LEAD's locality (not borrower's)
    // This is consistent with portfolioByLocality grouping
    // IMPORTANT: Use HISTORICAL filters based on targetWeek, not current state
    // This ensures we get loans that were active DURING that week, even if
    // they have since been finished or renewed
    const whereClause: any = {
      signDate: { lte: targetWeek.end },
      badDebtDate: null,
      excludedByCleanup: null,
      // Historical filters: include loans that weren't finished/renewed BEFORE the week started
      AND: [
        { OR: [{ finishedDate: null }, { finishedDate: { gte: targetWeek.start } }] },
        { OR: [{ renewedDate: null }, { renewedDate: { gte: targetWeek.start } }] },
      ],
    }

    // Filter by lead's locality
    if (localityId === 'sin-localidad') {
      // Loans where lead has no address
      whereClause.leadRelation = {
        personalDataRelation: {
          addresses: {
            none: {},
          },
        },
      }
    } else {
      // Loans where lead's address is in the specified locality
      whereClause.leadRelation = {
        personalDataRelation: {
          addresses: {
            some: {
              location: localityId,
            },
          },
        },
      }
    }

    const loans = await this.prisma.loan.findMany({
      where: whereClause,
      include: {
        borrowerRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        leadRelation: {
          include: {
            personalDataRelation: {
              include: {
                addresses: {
                  take: 1,
                  include: {
                    locationRelation: true,
                  },
                },
              },
            },
          },
        },
        loantypeRelation: true,
        // IMPORTANT: Include ALL payments up to weekEnd (not just this week's) because
        // isInCarteraVencida/calculateCVContribution needs the full payment history
        // to calculate "surplusBefore" (accumulated overpayments from previous weeks)
        payments: {
          where: {
            receivedAt: {
              lte: targetWeek.end,
            },
          },
          orderBy: {
            receivedAt: 'asc',
          },
        },
      },
    })

    const result: LocalityClientDetail[] = []

    // Convert all loans to LoanForPortfolio format with ALL fields needed for CV calculation
    // This includes rate, requestedAmount, totalPaid, weekDuration, totalDebt
    const loansForPortfolio: LoanForPortfolio[] = loans.map((loan) => {
      const rate = loan.loantypeRelation?.rate ? new Decimal(loan.loantypeRelation.rate).toNumber() : 0
      const requestedAmount = new Decimal(loan.requestedAmount).toNumber()
      // IMPORTANT: Use requestedAmount * (1 + rate) for totalDebt calculation
      // This matches the logic in calculateCVContribution and ensures correct expectedWeekly
      // DO NOT use amountGived + profitAmount as profitAmount may include inherited debt
      const totalDebt = requestedAmount * (1 + rate)

      return {
        id: loan.id,
        pendingAmountStored: new Decimal(loan.pendingAmountStored).toNumber(),
        signDate: loan.signDate,
        finishedDate: loan.finishedDate,
        renewedDate: loan.renewedDate,
        badDebtDate: loan.badDebtDate,
        excludedByCleanup: loan.excludedByCleanup,
        previousLoan: loan.previousLoan,
        status: loan.status,
        // Fields needed for calculateCVContribution and isLoanConsideredOnDate
        rate,
        requestedAmount,
        totalPaid: new Decimal(loan.totalPaid).toNumber(),
        weekDuration: loan.loantypeRelation?.weekDuration ?? 16,
        totalDebt,
      }
    })
    const renewalMap = buildRenewalMap(loansForPortfolio)

    // Create a map for quick lookup
    const loanForPortfolioMap = new Map(loansForPortfolio.map((l) => [l.id, l]))

    // Reference date: use week end for historical analysis (consistent with countClientsStatus)
    const referenceDate = targetWeek.end

    for (const loan of loans) {
      const personalData = loan.borrowerRelation?.personalDataRelation
      const loanForPortfolio = loanForPortfolioMap.get(loan.id)!
      const payments = this.toPaymentsForCV(loan.payments)

      // Use calculateCVContribution (same as countClientsStatus) to determine CV status
      // This considers: surplus from previous weeks, partial payments (50% = 0.5 CV), grace period
      const cvContribution = calculateCVContribution(
        loanForPortfolio,
        payments,
        targetWeek,
        referenceDate,
        renewalMap
      )
      const inCV = cvContribution > 0

      // Determine category
      const isNewInWeek =
        loan.signDate >= targetWeek.start &&
        loan.signDate <= targetWeek.end &&
        !loan.previousLoan
      const isRenewedInWeek =
        loan.renewedDate &&
        loan.renewedDate >= targetWeek.start &&
        loan.renewedDate <= targetWeek.end
      const isFinishedInWeek =
        loan.finishedDate &&
        loan.finishedDate >= targetWeek.start &&
        loan.finishedDate <= targetWeek.end

      // Determine if it's a reintegro (renewed with same or less amount - simplified check)
      const isReintegro = isRenewedInWeek && loan.previousLoan !== null

      let clientCategory: ClientCategory = 'ACTIVO'
      if (inCV) {
        clientCategory = 'EN_CV'
      } else if (isNewInWeek) {
        clientCategory = 'NUEVO'
      } else if (isReintegro) {
        clientCategory = 'REINTEGRO'
      } else if (isRenewedInWeek) {
        clientCategory = 'RENOVADO'
      } else if (isFinishedInWeek) {
        clientCategory = 'FINALIZADO'
      }

      // Filter by category if specified
      if (category && clientCategory !== category) {
        continue
      }

      // Calculate days since last payment (use last payment in the payments array)
      let daysSinceLastPayment: number | null = null
      const lastPayment = loan.payments[loan.payments.length - 1] // payments are ordered by receivedAt asc
      if (lastPayment) {
        const diffTime = Date.now() - lastPayment.receivedAt.getTime()
        daysSinceLastPayment = Math.floor(diffTime / (1000 * 60 * 60 * 24))
      }

      // Calculate expected weekly payment and paid this week
      const weekDuration = loan.loantypeRelation?.weekDuration ?? 16
      const expectedWeekly = loanForPortfolio.totalDebt
        ? Math.round(loanForPortfolio.totalDebt / weekDuration)
        : 0

      // Calculate amount paid in the target week
      const paidThisWeek = payments
        .filter((p) => p.receivedAt >= targetWeek.start && p.receivedAt <= targetWeek.end)
        .reduce((sum, p) => sum + p.amount, 0)

      result.push({
        loanId: loan.id,
        clientName: personalData?.fullName || 'N/A',
        clientCode: personalData?.clientCode || '',
        amountGived: new Decimal(loan.amountGived).toNumber(),
        pendingAmount: new Decimal(loan.pendingAmountStored).toNumber(),
        signDate: loan.signDate,
        cvStatus: inCV ? ('EN_CV' as CVStatus) : ('AL_CORRIENTE' as CVStatus),
        daysSinceLastPayment,
        loanType: loan.loantypeRelation?.name || 'N/A',
        category: clientCategory,
        expectedWeekly,
        paidThisWeek,
      })
    }

    return result.sort((a, b) => a.clientName.localeCompare(b.clientName))
  }

  // ========== Private Helper Methods ==========

  /**
   * Gets loans with borrower locality information for a given week
   *
   * IMPORTANT: A loan is considered "active" only if:
   * - renewedDate is null (hasn't been renewed - the NEW loan is active, not the old one)
   * - finishedDate is null (hasn't finished paying)
   *
   * For movements tracking (nuevos, renovados):
   * - "Nuevo" = new loan signed this week WITHOUT a previousLoan
   * - "Renovado" = new loan signed this week WITH a previousLoan (this is the NEW active loan)
   * - "Finalizado" = we need a separate query to track loans that finished this week
   */
  private async getLoansWithBorrowerLocality(
    weekRange: WeekRange,
    filters?: PortfolioFilters
  ) {
    // Build date-based where clause for historical analysis
    // This matches getActiveLoansWithPaymentsForMonth logic:
    // - Loans signed before or during the week
    // - Loans not finished before the week started (or still active)
    // - Loans not renewed before the week started (or never renewed)
    // - Loans not marked as bad debt or excluded by cleanup
    const baseWhereClause: Record<string, unknown> = {
      signDate: { lte: weekRange.end },
      badDebtDate: null,
      excludedByCleanup: null,
      AND: [
        { OR: [{ finishedDate: null }, { finishedDate: { gte: weekRange.start } }] },
        { OR: [{ renewedDate: null }, { renewedDate: { gte: weekRange.start } }] },
      ],
    }

    // Apply route filter with OR condition (snapshotRouteId OR lead's routes)
    if (filters?.routeIds?.length) {
      baseWhereClause.OR = [
        { snapshotRouteId: { in: filters.routeIds } },
        {
          leadRelation: {
            routes: {
              some: { id: { in: filters.routeIds } },
            },
          },
        },
      ]
    }

    // Apply loan type filter
    if (filters?.loantypeIds?.length) {
      baseWhereClause.loantype = { in: filters.loantypeIds }
    }

    // Query 1: Get active loans for the week
    const activeLoans = await this.prisma.loan.findMany({
      where: baseWhereClause,
      include: {
        // Include lead (loanOfficer) to get their locality and routes
        leadRelation: {
          include: {
            routes: true,  // Include lead's assigned routes for route priority
            personalDataRelation: {
              include: {
                addresses: {
                  take: 1,
                  include: {
                    locationRelation: {
                      include: {
                        routeRelation: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        // Include loantype to get the rate for CV calculation
        loantypeRelation: true,
        // IMPORTANT: Include ALL payments (not just this week's) because
        // calculateCVContribution needs the full payment history to calculate
        // "surplusBefore" (accumulated overpayments from previous weeks)
        payments: {
          where: {
            receivedAt: {
              lte: weekRange.end,
            },
          },
          orderBy: {
            receivedAt: 'asc',
          },
        },
      },
    })

    // Query 2: Get loans that finished this week (for "finalizados" count)
    // Build where clause with OR condition for routes
    const finishedLoansWhere: Record<string, unknown> = {
      badDebtDate: null,
      excludedByCleanup: null,
      renewedDate: null, // Finished without renewal
      finishedDate: {
        gte: weekRange.start,
        lte: weekRange.end,
      },
      ...(filters?.loantypeIds?.length && { loantype: { in: filters.loantypeIds } }),
    }

    // Apply route filter with OR condition
    if (filters?.routeIds?.length) {
      finishedLoansWhere.OR = [
        { snapshotRouteId: { in: filters.routeIds } },
        {
          leadRelation: {
            routes: {
              some: { id: { in: filters.routeIds } },
            },
          },
        },
      ]
    }

    const finishedLoans = await this.prisma.loan.findMany({
      where: finishedLoansWhere,
      include: {
        // Include lead (loanOfficer) to get their locality and routes
        leadRelation: {
          include: {
            routes: true,  // Include lead's assigned routes
            personalDataRelation: {
              include: {
                addresses: {
                  take: 1,
                  include: {
                    locationRelation: {
                      include: {
                        routeRelation: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    // Map active loans
    const result = activeLoans.map((loan) => {
      // Get locality from lead's address
      const address = loan.leadRelation?.personalDataRelation?.addresses?.[0]
      const location = address?.locationRelation
      const locationRoute = location?.routeRelation

      // Get lead's assigned routes
      const leadRoutes = loan.leadRelation?.routes || []
      const leadRoute = leadRoutes[0]

      // Route assignment logic:
      // When filtering by route, if the loan matches via lead's route (not snapshotRouteId),
      // we should use the lead's route that matches the filter.
      // This ensures localitites are grouped correctly for the selected route.
      let routeId: string | undefined
      let routeName: string | undefined

      if (filters?.routeIds?.length) {
        // Check if any of lead's routes match the filter
        const matchingLeadRoute = leadRoutes.find(r => filters.routeIds!.includes(r.id))
        if (matchingLeadRoute) {
          // Use the matching lead route (current assignment)
          routeId = matchingLeadRoute.id
          routeName = matchingLeadRoute.name
        } else if (loan.snapshotRouteId && filters.routeIds.includes(loan.snapshotRouteId)) {
          // Loan matched via snapshotRouteId
          routeId = loan.snapshotRouteId
          routeName = loan.snapshotRouteName || undefined
        } else {
          // Fallback (shouldn't happen if filter is working)
          routeId = loan.snapshotRouteId || leadRoute?.id || locationRoute?.id || undefined
          routeName = loan.snapshotRouteName || leadRoute?.name || locationRoute?.name || undefined
        }
      } else {
        // No filter - use original priority (snapshotRouteId first for historical accuracy)
        routeId = loan.snapshotRouteId || leadRoute?.id || locationRoute?.id || undefined
        routeName = loan.snapshotRouteName || leadRoute?.name || locationRoute?.name || undefined
      }

      // "Nuevo" = signed this week without a previous loan
      const isNew =
        loan.signDate >= weekRange.start &&
        loan.signDate <= weekRange.end &&
        !loan.previousLoan

      // "Renovado" = signed this week WITH a previous loan (this IS the new active loan)
      const isRenewed =
        loan.signDate >= weekRange.start &&
        loan.signDate <= weekRange.end &&
        loan.previousLoan !== null

      // Reintegro is a type of renovation
      const isReintegro = isRenewed

      // A loan is "active" at the end of the week if:
      // - Not finished during or before the week (finishedDate is null or after week end)
      // - Not renewed during or before the week (renewedDate is null or after week end)
      const isLoanStillActive =
        (loan.finishedDate === null || loan.finishedDate > weekRange.end) &&
        (loan.renewedDate === null || loan.renewedDate > weekRange.end)

      // Calculate totalDebt for CV calculation
      // IMPORTANT: Use requestedAmount * (1 + rate) for correct expectedWeekly calculation
      // DO NOT use amountGived + profitAmount as profitAmount may include inherited debt
      const rate = loan.loantypeRelation?.rate ? new Decimal(loan.loantypeRelation.rate).toNumber() : 0
      const requestedAmount = new Decimal(loan.requestedAmount).toNumber()
      const totalDebt = requestedAmount * (1 + rate)

      return {
        id: loan.id,
        pendingAmountStored: new Decimal(loan.pendingAmountStored).toNumber(),
        signDate: loan.signDate,
        finishedDate: loan.finishedDate,
        renewedDate: loan.renewedDate,
        badDebtDate: loan.badDebtDate,
        excludedByCleanup: loan.excludedByCleanup,
        previousLoan: loan.previousLoan,
        status: loan.status,
        // Campos necesarios para isLoanConsideredOnDate y CV calculation
        rate,
        requestedAmount,
        totalPaid: new Decimal(loan.totalPaid).toNumber(),
        weekDuration: loan.loantypeRelation?.weekDuration ?? 16,
        totalDebt,
        localityId: location?.id,
        localityName: location?.name,
        routeId,
        routeName,
        payments: this.toPaymentsForCV(loan.payments),
        isNew,
        isRenewed,
        isReintegro,
        isFinished: loan.finishedDate !== null && loan.finishedDate <= weekRange.end,
        isActive: isLoanStillActive,
      }
    })

    // Add finished loans (for counting purposes, marked as not active)
    for (const loan of finishedLoans) {
      // Skip if already in active loans (shouldn't happen with our filters)
      if (result.find(r => r.id === loan.id)) continue

      // Get locality from lead's address
      const address = loan.leadRelation?.personalDataRelation?.addresses?.[0]
      const location = address?.locationRelation
      const locationRoute = location?.routeRelation

      // Route priority (consistent with Keystone's getActiveLoansReport):
      // 1. snapshotRouteId (historical, set when loan was created)
      // 2. Lead's locality route (fallback)
      const routeId = loan.snapshotRouteId || locationRoute?.id || undefined
      const routeName = loan.snapshotRouteName || locationRoute?.name || undefined

      result.push({
        id: loan.id,
        pendingAmountStored: new Decimal(loan.pendingAmountStored).toNumber(),
        signDate: loan.signDate,
        finishedDate: loan.finishedDate,
        renewedDate: loan.renewedDate,
        badDebtDate: loan.badDebtDate,
        excludedByCleanup: loan.excludedByCleanup,
        previousLoan: loan.previousLoan,
        status: loan.status,
        // Campos necesarios para isLoanConsideredOnDate
        // Finished loans don't need accurate rate/requestedAmount/totalPaid since they're already finished
        rate: 0,
        requestedAmount: new Decimal(loan.requestedAmount).toNumber(),
        totalPaid: new Decimal(loan.totalPaid).toNumber(),
        weekDuration: 16, // Default, not used for finished loans
        totalDebt: 0,     // Not used for finished loans
        localityId: location?.id,
        localityName: location?.name,
        routeId,
        routeName,
        payments: [],
        isNew: false,
        isRenewed: false,
        isReintegro: false,
        isFinished: true,
        isActive: false, // Finished loans are not active
      })
    }

    return result
  }

  private getDateFromWeekNumber(year: number, weekNumber: number): Date {
    const jan4 = new Date(year, 0, 4)
    const dayOfWeek = jan4.getDay() || 7
    const firstMonday = new Date(jan4)
    firstMonday.setDate(jan4.getDate() - dayOfWeek + 1)

    const targetDate = new Date(firstMonday)
    targetDate.setDate(firstMonday.getDate() + (weekNumber - 1) * 7)

    return targetDate
  }

  private toLoanForPortfolio(loan: Loan): LoanForPortfolio {
    return {
      id: loan.id,
      pendingAmountStored: new Decimal(loan.pendingAmountStored).toNumber(),
      signDate: loan.signDate,
      finishedDate: loan.finishedDate,
      renewedDate: loan.renewedDate,
      badDebtDate: loan.badDebtDate,
      excludedByCleanup: loan.excludedByCleanup,
      previousLoan: loan.previousLoan,
      status: loan.status,
    }
  }

  private toPaymentsForCV(payments: LoanPayment[]): PaymentForCV[] {
    return payments.map((p) => ({
      id: p.id,
      receivedAt: p.receivedAt,
      amount: new Decimal(p.amount).toNumber(),
    }))
  }

  /**
   * Filters payments by week range from a Map of all payments.
   * Returns a new Map containing only payments within the specified week.
   */
  private filterPaymentsByWeek(
    allPayments: Map<string, PaymentForCV[]>,
    week: WeekRange
  ): Map<string, PaymentForCV[]> {
    const filteredMap = new Map<string, PaymentForCV[]>()
    for (const [loanId, payments] of allPayments.entries()) {
      const weekPayments = payments.filter(
        (p) => p.receivedAt >= week.start && p.receivedAt <= week.end
      )
      if (weekPayments.length > 0) {
        filteredMap.set(loanId, weekPayments)
      }
    }
    return filteredMap
  }

  /**
   * Gets route priority based on snapshot and lead data.
   * Priority: lead's route > snapshotRouteId > 'unknown'
   * (Prioriza la ruta actual del lead para reflejar cambios de asignación)
   */
  private getRoutePriority(
    loan: {
      snapshotRouteId?: string | null
      snapshotRoute?: { name: string } | null
      snapshotRouteName?: string | null
    },
    leadRoute?: { id: string; name: string } | null
  ): { routeId: string; routeName: string } {
    return {
      routeId: leadRoute?.id || loan.snapshotRouteId || 'unknown',
      routeName:
        leadRoute?.name ||
        loan.snapshotRoute?.name ||
        loan.snapshotRouteName ||
        'Sin ruta',
    }
  }

  /**
   * Optimized method to get active loans with payments for a month period.
   *
   * OPTIMIZACIONES:
   * 1. Usa raw SQL con JOINs para obtener todo en 2 queries paralelas
   * 2. Solo trae pagos del período (no todos los históricos)
   * 3. Usa totalPaid almacenado en lugar de calcularlo
   *
   * @param periodStart - Start date of the period
   * @param periodEnd - End date of the period
   * @param filters - Optional filters
   * @returns Loans and their payments in the period
   */
  async getActiveLoansWithPaymentsForMonth(
    periodStart: Date,
    periodEnd: Date,
    filters?: PortfolioFilters
  ): Promise<{
    loans: LoanForPortfolio[]
    allPayments: Map<string, PaymentForCV[]>
    routeInfoMap: Map<string, { routeId: string; routeName: string }>
  }> {
    // Build WHERE conditions for raw SQL
    // These conditions match buildActiveLoansWhereClause but allow historical analysis:
    // - Loans signed before the period end
    // - Loans not finished before period start (or still active)
    // - Loans not renewed before period start (or never renewed)
    // - Loans not marked as bad debt
    // - Loans not excluded by cleanup
    const conditions: string[] = [
      `l."signDate" <= $1`,
      `(l."finishedDate" IS NULL OR l."finishedDate" >= $2)`,
      `(l."renewedDate" IS NULL OR l."renewedDate" >= $2)`,
      `l."badDebtDate" IS NULL`,
      `l."excludedByCleanup" IS NULL`,
    ]
    const params: unknown[] = [periodEnd, periodStart]
    let paramIndex = 3

    // Route filter
    if (filters?.routeIds?.length) {
      const routePlaceholders = filters.routeIds.map((_, i) => `$${paramIndex + i}`).join(', ')
      conditions.push(`(l."snapshotRouteId" IN (${routePlaceholders}) OR lr.id IN (${routePlaceholders}))`)
      params.push(...filters.routeIds)
      paramIndex += filters.routeIds.length
    }

    // Loan type filter
    if (filters?.loantypeIds?.length) {
      const ltPlaceholders = filters.loantypeIds.map((_, i) => `$${paramIndex + i}`).join(', ')
      conditions.push(`l.loantype IN (${ltPlaceholders})`)
      params.push(...filters.loantypeIds)
      paramIndex += filters.loantypeIds.length
    }

    const whereClause = conditions.join(' AND ')

    // Query 1: Loans with route info (single query with JOINs)
    // Query 2: Payments for the period
    // Run both in parallel
    const [loansResult, paymentsResult] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{
        id: string
        signDate: Date
        finishedDate: Date | null
        renewedDate: Date | null
        badDebtDate: Date | null
        previousLoan: string | null
        status: string
        pendingAmountStored: string
        requestedAmount: string
        totalPaid: string
        excludedByCleanup: string | null
        cleanupDate: Date | null
        snapshotRouteId: string | null
        snapshotRouteName: string | null
        leadRouteId: string | null
        leadRouteName: string | null
        rate: string | null
        weekDuration: number | null
        amountGived: string
        profitAmount: string
      }>>(`
        SELECT DISTINCT ON (l.id)
          l.id,
          l."signDate",
          l."finishedDate",
          l."renewedDate",
          l."badDebtDate",
          l."previousLoan",
          l.status,
          l."pendingAmountStored"::text,
          l."requestedAmount"::text,
          l."totalPaid"::text,
          l."excludedByCleanup",
          c."cleanupDate",
          l."snapshotRouteId",
          sr.name as "snapshotRouteName",
          lr.id as "leadRouteId",
          lr.name as "leadRouteName",
          lt.rate::text,
          lt."weekDuration",
          l."amountGived"::text,
          l."profitAmount"::text
        FROM "Loan" l
        LEFT JOIN "Route" sr ON l."snapshotRouteId" = sr.id
        LEFT JOIN "Loantype" lt ON l.loantype = lt.id
        LEFT JOIN "PortfolioCleanup" c ON l."excludedByCleanup" = c.id
        LEFT JOIN "Employee" e ON l.lead = e.id
        LEFT JOIN "_RouteEmployees" re ON e.id = re."B"
        LEFT JOIN "Route" lr ON re."A" = lr.id
        WHERE ${whereClause}
        ORDER BY l.id, lr.id
      `, ...params),

      // Separate query for ALL payments (needed for surplus calculation)
      // We need payments before each week to calculate surplus, so we get all payments up to periodEnd
      // Use same loan conditions as the main query
      this.prisma.$queryRawUnsafe<Array<{
        id: string
        loan: string
        amount: string
        receivedAt: Date
      }>>(`
        SELECT p.id, p.loan, p.amount::text, p."receivedAt"
        FROM "LoanPayment" p
        INNER JOIN "Loan" l ON p.loan = l.id
        WHERE p."receivedAt" <= $1
          AND l."signDate" <= $2
          AND (l."finishedDate" IS NULL OR l."finishedDate" >= $3)
          AND (l."renewedDate" IS NULL OR l."renewedDate" >= $3)
          AND l."badDebtDate" IS NULL
          AND l."excludedByCleanup" IS NULL
          ${filters?.routeIds?.length ? `AND (l."snapshotRouteId" IN (${filters.routeIds.map((_, i) => `$${4 + i}`).join(', ')}) OR EXISTS (
            SELECT 1 FROM "Employee" e2
            JOIN "_RouteEmployees" re2 ON e2.id = re2."B"
            WHERE e2.id = l.lead AND re2."A" IN (${filters.routeIds.map((_, i) => `$${4 + i}`).join(', ')})
          ))` : ''}
          ${filters?.loantypeIds?.length ? `AND l.loantype IN (${filters.loantypeIds.map((_, i) => `$${4 + (filters?.routeIds?.length || 0) + i}`).join(', ')})` : ''}
      `, periodEnd, periodEnd, periodStart, ...(filters?.routeIds || []), ...(filters?.loantypeIds || [])),
    ])

    // Process loans
    const loans: LoanForPortfolio[] = []
    const routeInfoMap = new Map<string, { routeId: string; routeName: string }>()

    for (const loan of loansResult) {
      // Calculate totalDebt for CV calculation
      // IMPORTANT: Use requestedAmount * (1 + rate) for correct expectedWeekly calculation
      // DO NOT use amountGived + profitAmount as profitAmount may include inherited debt
      const requestedAmount = loan.requestedAmount ? parseFloat(loan.requestedAmount) : 0
      const rate = loan.rate ? parseFloat(loan.rate) : 0
      const totalDebt = requestedAmount * (1 + rate)

      loans.push({
        id: loan.id,
        pendingAmountStored: loan.pendingAmountStored ? parseFloat(loan.pendingAmountStored) : 0,
        signDate: loan.signDate,
        finishedDate: loan.finishedDate,
        renewedDate: loan.renewedDate,
        badDebtDate: loan.badDebtDate,
        excludedByCleanup: loan.excludedByCleanup,
        cleanupDate: loan.cleanupDate,
        previousLoan: loan.previousLoan,
        status: loan.status,
        requestedAmount, // Use the safe-parsed value from above
        rate, // Use the safe-parsed value from above
        totalPaid: loan.totalPaid ? parseFloat(loan.totalPaid) : 0,
        weekDuration: loan.weekDuration ?? 16,
        totalDebt,
      })

      // Route priority: leadRoute > snapshotRoute > unknown
      const routeId = loan.leadRouteId || loan.snapshotRouteId || 'unknown'
      const routeName = loan.leadRouteName || loan.snapshotRouteName || 'Sin ruta'
      routeInfoMap.set(loan.id, { routeId, routeName })
    }

    // Process payments into Map
    const allPayments = new Map<string, PaymentForCV[]>()
    for (const payment of paymentsResult) {
      if (!allPayments.has(payment.loan)) {
        allPayments.set(payment.loan, [])
      }
      allPayments.get(payment.loan)!.push({
        id: payment.id,
        receivedAt: payment.receivedAt,
        amount: parseFloat(payment.amount),
      })
    }

    return { loans, allPayments, routeInfoMap }
  }

  /**
   * Helper para obtener routeId y routeName de los datos del préstamo
   * Priority: leadRoute > snapshotRoute > 'unknown'
   * (Prioriza la ruta actual del lead para reflejar cambios de asignación)
   */
  private getRoutePriorityFromData(
    snapshotRouteId: string | null,
    snapshotRoute: { id: string; name: string } | null,
    leadRoute: { id: string; name: string } | null
  ): { routeId: string; routeName: string } {
    // Priorizar ruta actual del lead
    if (leadRoute) {
      return { routeId: leadRoute.id, routeName: leadRoute.name }
    }
    // Fallback a snapshot route
    if (snapshotRouteId && snapshotRoute) {
      return { routeId: snapshotRoute.id, routeName: snapshotRoute.name }
    }
    return { routeId: 'unknown', routeName: 'Sin ruta' }
  }

  async getActiveLoansWithPayments(
    weekRange: WeekRange,
    filters?: PortfolioFilters
  ): Promise<{
    loans: LoanForPortfolio[]
    paymentsMap: Map<string, PaymentForCV[]>
  }> {
    // LÓGICA ORIGINAL: Traer todos los préstamos firmados antes del fin de la semana
    const whereClause: Record<string, unknown> = {
      signDate: { lte: weekRange.end },
    }

    // Apply route filter
    if (filters?.routeIds?.length) {
      whereClause.OR = [
        { snapshotRouteId: { in: filters.routeIds } },
        {
          leadRelation: {
            routes: {
              some: { id: { in: filters.routeIds } },
            },
          },
        },
      ]
    }

    // Apply loan type filter
    if (filters?.loantypeIds?.length) {
      whereClause.loantype = { in: filters.loantypeIds }
    }

    const dbLoans = await this.prisma.loan.findMany({
      where: whereClause,
      include: {
        loantypeRelation: true,
        excludedByCleanupRelation: true,
        payments: true, // Traer TODOS los pagos para calcular totalPaid
        leadRelation: filters?.routeIds?.length
          ? {
              include: {
                routes: true,
              },
            }
          : false,
      },
    })

    // Procesar en memoria (calcular totalPaid y filtrar pagos de la semana)
    const loans: LoanForPortfolio[] = []
    const paymentsMap = new Map<string, PaymentForCV[]>()

    for (const loan of dbLoans) {
      // Calcular totalPaid en memoria
      let totalPaid = 0
      const weekPayments: PaymentForCV[] = []

      for (const payment of loan.payments) {
        const amount = new Decimal(payment.amount).toNumber()
        totalPaid += amount

        // Filtrar pagos de la semana
        if (payment.receivedAt >= weekRange.start && payment.receivedAt <= weekRange.end) {
          weekPayments.push({
            id: payment.id,
            receivedAt: payment.receivedAt,
            amount,
          })
        }
      }

      loans.push({
        id: loan.id,
        pendingAmountStored: new Decimal(loan.pendingAmountStored).toNumber(),
        signDate: loan.signDate,
        finishedDate: loan.finishedDate,
        renewedDate: loan.renewedDate,
        badDebtDate: loan.badDebtDate,
        excludedByCleanup: loan.excludedByCleanupRelation?.id || null,
        cleanupDate: loan.excludedByCleanupRelation?.cleanupDate || null,
        previousLoan: loan.previousLoan,
        status: loan.status,
        requestedAmount: new Decimal(loan.requestedAmount).toNumber(),
        rate: loan.loantypeRelation?.rate
          ? new Decimal(loan.loantypeRelation.rate).toNumber()
          : 0,
        totalPaid,
      })

      paymentsMap.set(loan.id, weekPayments)
    }

    return { loans, paymentsMap }
  }

  private async calculateSummary(
    loans: LoanForPortfolio[],
    paymentsMap: Map<string, PaymentForCV[]>,
    activeWeek: WeekRange,
    previousWeek: WeekRange | null,
    periodStart: Date,
    periodEnd: Date,
    previousPeriodStart?: Date | null,
    previousPeriodEnd?: Date | null
  ): Promise<PortfolioSummary> {
    // Use historical calculation for completed weeks
    const isHistorical = this.isWeekCompleted(activeWeek)
    const status = countClientsStatus(loans, paymentsMap, activeWeek, isHistorical)
    const clientBalance = calculateClientBalance(loans, periodStart, periodEnd)

    let comparison = null
    if (previousPeriodStart && previousPeriodEnd && previousWeek) {
      const { loans: prevLoans, paymentsMap: prevPaymentsMap } =
        await this.getActiveLoansWithPayments(previousWeek)
      // Previous week is always historical
      const prevStatus = countClientsStatus(
        prevLoans,
        prevPaymentsMap,
        previousWeek,
        true // always historical
      )
      const prevBalance = calculateClientBalance(
        prevLoans,
        previousPeriodStart,
        previousPeriodEnd
      )

      comparison = {
        previousPeriod: {
          clientesActivos: prevStatus.totalActivos,
          clientesEnCV: prevStatus.enCV,
          balance: prevBalance.balance,
        },
        cvChange: status.enCV - prevStatus.enCV,
        balanceChange: clientBalance.balance - prevBalance.balance,
      }
    }

    return {
      totalClientesActivos: status.totalActivos,
      clientesAlCorriente: status.alCorriente,
      clientesEnCV: status.enCV,
      clientBalance,
      comparison,
    }
  }

  /**
   * Calculates summary for monthly reports with CV average from completed weeks
   */
  private async calculateSummaryForMonth(
    loans: LoanForPortfolio[],
    paymentsMap: Map<string, PaymentForCV[]>,
    lastCompletedWeek: WeekRange | null,
    previousWeek: WeekRange | null,
    periodStart: Date,
    periodEnd: Date,
    previousPeriodStart: Date | null,
    previousPeriodEnd: Date | null,
    promedioCV: number,
    semanasCompletadas: number,
    totalSemanas: number,
    _filters?: PortfolioFilters
  ): Promise<PortfolioSummary> {
    // OPTIMIZACIÓN: Usar los loans que ya tenemos en lugar de hacer otra query
    // Los loans ya incluyen todos los préstamos relevantes para el período
    const clientBalance = calculateClientBalance(loans, periodStart, periodEnd)

    // Determine if this is the current month (has incomplete weeks)
    const now = new Date()
    const isCurrentMonth = periodEnd >= now

    // Get status from last completed week (if any)
    let status = { totalActivos: 0, alCorriente: 0, enCV: 0 }
    if (lastCompletedWeek) {
      if (isCurrentMonth) {
        status = countClientsStatus(loans, paymentsMap, lastCompletedWeek, false)
      } else {
        status = countClientsStatus(loans, paymentsMap, lastCompletedWeek, true)
      }
    } else {
      status = {
        totalActivos: loans.length,
        alCorriente: loans.length,
        enCV: 0,
      }
    }

    // Calculate clients at the START of the period
    const startReferenceDate = new Date(periodStart.getTime() - 1)
    const clientesActivosInicio = countActiveLoansAtDate(loans, startReferenceDate)

    // OPTIMIZACIÓN: Calcular comparación usando los mismos loans (sin query adicional)
    // Para período anterior, usamos los mismos loans filtrando por fecha
    let comparison = null
    if (previousPeriodStart && previousPeriodEnd && previousWeek) {
      // Usar los mismos loans - isLoanConsideredOnDate ya filtra por fecha
      const prevStatus = countClientsStatus(
        loans,
        paymentsMap, // No tenemos pagos del período anterior, pero CV de semana anterior no es crítico
        previousWeek,
        true // always historical
      )
      const prevBalance = calculateClientBalance(
        loans,
        previousPeriodStart,
        previousPeriodEnd
      )

      comparison = {
        previousPeriod: {
          clientesActivos: prevStatus.totalActivos,
          clientesEnCV: prevStatus.enCV,
          balance: prevBalance.balance,
        },
        cvChange: status.enCV - prevStatus.enCV,
        balanceChange: clientBalance.balance - prevBalance.balance,
      }
    }

    return {
      clientesActivosInicio,
      totalClientesActivos: status.totalActivos,
      clientesAlCorriente: status.alCorriente,
      clientesEnCV: status.enCV,
      promedioCV,
      semanasCompletadas,
      totalSemanas,
      clientBalance,
      comparison,
    }
  }

  private async getRouteBreakdown(
    loans: LoanForPortfolio[],
    paymentsMap: Map<string, PaymentForCV[]>,
    activeWeek: WeekRange,
    _filters?: PortfolioFilters,
    routeInfoMap?: Map<string, { routeId: string; routeName: string }>
  ): Promise<LocationBreakdown[]> {
    // Group loans by route
    const loansByRoute = new Map<
      string,
      { loans: LoanForPortfolio[]; routeName: string }
    >()

    // OPTIMIZATION: If routeInfoMap is provided, use it instead of querying
    if (routeInfoMap) {
      for (const loan of loans) {
        const routeInfo = routeInfoMap.get(loan.id)
        const routeId = routeInfo?.routeId || 'unknown'
        const routeName = routeInfo?.routeName || 'Sin ruta'

        if (!loansByRoute.has(routeId)) {
          loansByRoute.set(routeId, { loans: [], routeName })
        }
        loansByRoute.get(routeId)!.loans.push(loan)
      }
    } else {
      // Fallback: Query route info from DB (used by getWeeklyReport)
      const loanIds = loans.map((l) => l.id)

      const dbLoans = await this.prisma.loan.findMany({
        where: { id: { in: loanIds } },
        include: {
          snapshotRoute: true,
          leadRelation: {
            include: {
              routes: true,
            },
          },
        },
      })

      for (const dbLoan of dbLoans) {
        const leadRoutes = dbLoan.leadRelation?.routes || []
        const leadRoute = leadRoutes.length > 0 ? leadRoutes[0] : null

        // Get route using priority helper
        const { routeId, routeName } = this.getRoutePriority(dbLoan, leadRoute)
        const loan = loans.find((l) => l.id === dbLoan.id)
        if (!loan) continue

        if (!loansByRoute.has(routeId)) {
          loansByRoute.set(routeId, { loans: [], routeName })
        }
        loansByRoute.get(routeId)!.loans.push(loan)
      }
    }

    const result: LocationBreakdown[] = []
    const isHistorical = this.isWeekCompleted(activeWeek)

    for (const [routeId, data] of loansByRoute) {
      const routePaymentsMap = new Map<string, PaymentForCV[]>()
      for (const loan of data.loans) {
        routePaymentsMap.set(loan.id, paymentsMap.get(loan.id) || [])
      }

      const status = countClientsStatus(
        data.loans,
        routePaymentsMap,
        activeWeek,
        isHistorical
      )
      const balance = calculateClientBalance(
        data.loans,
        activeWeek.start,
        activeWeek.end
      )

      result.push({
        locationId: routeId,
        locationName: data.routeName,
        routeId: routeId,
        routeName: data.routeName,
        clientesActivos: status.totalActivos,
        clientesAlCorriente: status.alCorriente,
        clientesEnCV: status.enCV,
        balance: balance.balance,
      })
    }

    return result.sort((a, b) => b.clientesActivos - a.clientesActivos)
  }

  /**
   * Get route breakdown with pre-calculated averages from weekly stats.
   * This is a more efficient version that uses pre-computed stats.
   */
  private async getRouteBreakdownWithAverages(
    loans: LoanForPortfolio[],
    paymentsMap: Map<string, PaymentForCV[]>,
    activeWeek: WeekRange,
    _filters: PortfolioFilters | undefined,
    routeInfoMap: Map<string, { routeId: string; routeName: string }>,
    routeWeeklyStats: Map<string, { alCorriente: number[], enCV: number[], lastWeekClientes: number, lastWeekAlCorriente: number, lastWeekCV: number }>
  ): Promise<LocationBreakdown[]> {
    // Group loans by route
    const loansByRoute = new Map<string, { loans: LoanForPortfolio[]; routeName: string }>()

    for (const loan of loans) {
      const routeInfo = routeInfoMap.get(loan.id)
      const routeId = routeInfo?.routeId || 'unknown'
      const routeName = routeInfo?.routeName || 'Sin ruta'

      if (!loansByRoute.has(routeId)) {
        loansByRoute.set(routeId, { loans: [], routeName })
      }
      loansByRoute.get(routeId)!.loans.push(loan)
    }

    const result: LocationBreakdown[] = []
    const isHistorical = this.isWeekCompleted(activeWeek)

    for (const [routeId, data] of loansByRoute) {
      const routePaymentsMap = new Map<string, PaymentForCV[]>()
      for (const loan of data.loans) {
        routePaymentsMap.set(loan.id, paymentsMap.get(loan.id) || [])
      }

      const status = countClientsStatus(
        data.loans,
        routePaymentsMap,
        activeWeek,
        isHistorical
      )
      const balance = calculateClientBalance(
        data.loans,
        activeWeek.start,
        activeWeek.end
      )

      // Get pre-calculated stats for averages
      const stats = routeWeeklyStats.get(routeId)
      let pagandoPromedio: number | undefined
      let cvPromedio: number | undefined

      if (stats && stats.alCorriente.length > 0) {
        // Calculate averages from weekly stats
        const sumAlCorriente = stats.alCorriente.reduce((a, b) => a + b, 0)
        const sumEnCV = stats.enCV.reduce((a, b) => a + b, 0)
        pagandoPromedio = Math.round(sumAlCorriente / stats.alCorriente.length * 100) / 100
        cvPromedio = Math.round(sumEnCV / stats.enCV.length * 100) / 100
      }

      result.push({
        locationId: routeId,
        locationName: data.routeName,
        routeId: routeId,
        routeName: data.routeName,
        clientesActivos: status.totalActivos,
        clientesAlCorriente: status.alCorriente,
        clientesEnCV: status.enCV,
        balance: balance.balance,
        pagandoPromedio,
        cvPromedio,
      })
    }

    return result.sort((a, b) => b.clientesActivos - a.clientesActivos)
  }

  private async getRenovationKPIs(
    periodStart: Date,
    periodEnd: Date,
    filters?: PortfolioFilters
  ): Promise<RenovationKPIs> {
    // Build conditions
    const conditions: string[] = [
      `(
        (l."renewedDate" >= $1 AND l."renewedDate" <= $2)
        OR (l."finishedDate" >= $1 AND l."finishedDate" <= $2 AND l."renewedDate" IS NULL)
      )`,
    ]
    const params: unknown[] = [periodStart, periodEnd]
    let paramIndex = 3

    if (filters?.routeIds?.length) {
      const placeholders = filters.routeIds.map((_, i) => `$${paramIndex + i}`).join(', ')
      conditions.push(`l."snapshotRouteId" IN (${placeholders})`)
      params.push(...filters.routeIds)
      paramIndex += filters.routeIds.length
    }

    if (filters?.loantypeIds?.length) {
      const placeholders = filters.loantypeIds.map((_, i) => `$${paramIndex + i}`).join(', ')
      conditions.push(`l.loantype IN (${placeholders})`)
      params.push(...filters.loantypeIds)
    }

    const loans = await this.prisma.$queryRawUnsafe<Array<{
      id: string
      signDate: Date
      finishedDate: Date | null
      renewedDate: Date | null
      badDebtDate: Date | null
      previousLoan: string | null
      status: string
      pendingAmountStored: string
    }>>(`
      SELECT
        l.id,
        l."signDate",
        l."finishedDate",
        l."renewedDate",
        l."badDebtDate",
        l."previousLoan",
        l.status,
        l."pendingAmountStored"::text
      FROM "Loan" l
      WHERE ${conditions.join(' AND ')}
    `, ...params)

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
    }))

    return calculateRenovationKPIs(portfolioLoans, periodStart, periodEnd)
  }
}
