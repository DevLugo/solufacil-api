import { Decimal } from 'decimal.js'
import type { PrismaClient, Loan, LoanPayment } from '@solufacil/database'
import { currentSchema } from '@solufacil/database'
import { LocationHistoryService } from './LocationHistoryService'
import {
  getActiveWeekRange,
  getWeeksInMonth,
  getPreviousWeek,
  isInCarteraVencida,
  calculateClientBalance,
  calculateRenovationKPIs,
  countClientsStatus,
  countActiveLoansAtDate,
  isLoanActiveAtDate,
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
  private locationHistoryService: LocationHistoryService

  constructor(private prisma: PrismaClient) {
    this.locationHistoryService = new LocationHistoryService(prisma)
  }

  /**
   * Gets the schema prefix for raw queries.
   * Returns empty string for 'public' schema, otherwise returns '"schema".'
   * This is needed because $queryRawUnsafe doesn't use Prisma's schema configuration.
   */
  private get schemaPrefix(): string {
    // Use currentSchema from DATABASE_URL, fallback to POSTGRES_SCHEMA env var, or 'solufacil_mono' for production
    const schema = currentSchema && currentSchema !== 'public'
      ? currentSchema
      : process.env.POSTGRES_SCHEMA || (process.env.NODE_ENV === 'production' ? 'solufacil_mono' : '')

    const prefix = schema ? `"${schema}".` : ''
    console.log(`[PortfolioReportService] schemaPrefix: "${prefix}", currentSchema: "${currentSchema}", env.POSTGRES_SCHEMA: "${process.env.POSTGRES_SCHEMA}"`)
    return prefix
  }

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
      /** Include location filter based on borrower's address */
      includeLocationFilter?: boolean
    } = {}
  ): Record<string, unknown> {
    const { includeLocationFilter = false } = options

    const whereClause: Record<string, unknown> = {
      pendingAmountStored: { gt: 0 },
      excludedByCleanup: null,
      renewedDate: null,
      finishedDate: null,
    }

    // Apply route filter - use lead's current route assignment only
    if (filters?.routeIds?.length) {
      whereClause.leadRelation = {
        routes: {
          some: { id: { in: filters.routeIds } },
        },
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

    // Call getRouteKPIs to get totals for "Por Rutas" tab
    const routeKPIs = await this.getRouteKPIs(year, month, filters)
    const totalClientesActivos = routeKPIs.reduce((sum, r) => sum + r.clientesTotal, 0)
    const pagandoPromedio = routeKPIs.reduce((sum, r) => sum + r.pagandoPromedio, 0)
    const cvPromedio = routeKPIs.reduce((sum, r) => sum + r.cvPromedio, 0)

    // Client balance for the period
    const clientBalance = calculateClientBalance(loans, periodStart, periodEnd)

    // Calculate clients at the START of the period using the balance formula
    // clientesActivosInicio = totalClientesActivos - balance
    // This ensures mathematical consistency: incremento = nuevos - terminadosSinRenovar
    const clientesActivosInicio = totalClientesActivos - clientBalance.balance

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
   * OPTIMIZED: Fetches all data ONCE and processes in memory.
   * A loan belongs to a route based on the lead's location at signDate (historical).
   */
  async getRouteKPIs(
    year: number,
    month: number,
    filters?: PortfolioFilters
  ): Promise<{ routeId: string; routeName: string; clientesTotal: number; pagandoPromedio: number; cvPromedio: number }[]> {
    const weeks = getWeeksInMonth(year, month - 1)
    if (weeks.length === 0) return []

    const completedWeeks = this.getCompletedWeeks(weeks)
    if (completedWeeks.length === 0) return []

    const lastCompletedWeek = completedWeeks[completedWeeks.length - 1]
    const s = this.schemaPrefix

    // Build WHERE conditions for raw SQL (with explicit timestamp casts for PostgreSQL)
    const conditions: string[] = [
      `l."signDate" <= $1::timestamp`,
      `l."excludedByCleanup" IS NULL`,
      `(l."finishedDate" IS NULL OR l."finishedDate" >= $2::timestamp)`,
      `(l."renewedDate" IS NULL OR l."renewedDate" >= $2::timestamp)`,
    ]
    const loansParams: unknown[] = [lastCompletedWeek.end, lastCompletedWeek.start]
    let paramIndex = 3

    if (filters?.loantypeIds?.length) {
      const ltPlaceholders = filters.loantypeIds.map((_, i) => `$${paramIndex + i}`).join(', ')
      conditions.push(`l.loantype IN (${ltPlaceholders})`)
      loansParams.push(...filters.loantypeIds)
      paramIndex += filters.loantypeIds.length
    }

    const whereClause = conditions.join(' AND ')

    // Build WHERE conditions for payments query (different param indices)
    const paymentsConditions: string[] = [
      `l."signDate" <= $2::timestamp`,
      `l."excludedByCleanup" IS NULL`,
      `(l."finishedDate" IS NULL OR l."finishedDate" >= $3::timestamp)`,
      `(l."renewedDate" IS NULL OR l."renewedDate" >= $3::timestamp)`,
    ]
    const paymentsParams: unknown[] = [lastCompletedWeek.end, lastCompletedWeek.end, lastCompletedWeek.start]
    let paymentsParamIndex = 4

    if (filters?.loantypeIds?.length) {
      const ltPlaceholders = filters.loantypeIds.map((_, i) => `$${paymentsParamIndex + i}`).join(', ')
      paymentsConditions.push(`l.loantype IN (${ltPlaceholders})`)
      paymentsParams.push(...filters.loantypeIds)
    }

    const paymentsWhereClause = paymentsConditions.join(' AND ')

    // OPTIMIZATION: Run loans and payments queries in parallel using raw SQL
    const [loansResult, paymentsResult] = await Promise.all([
      // Query 1: Loans with lead's locationId (no payments - fetched separately)
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
        leadLocationId: string | null
        rate: string | null
        weekDuration: number | null
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
          a.location as "leadLocationId",
          lt.rate::text,
          lt."weekDuration"
        FROM ${s}"Loan" l
        LEFT JOIN ${s}"Loantype" lt ON l.loantype = lt.id
        LEFT JOIN ${s}"Employee" e ON l.lead = e.id
        LEFT JOIN ${s}"PersonalData" pd ON e."personalData" = pd.id
        LEFT JOIN ${s}"Address" a ON pd.id = a."personalData"
        WHERE ${whereClause}
        ORDER BY l.id, a.id
      `, ...loansParams),

      // Query 2: Payments for loans matching the same conditions
      this.prisma.$queryRawUnsafe<Array<{
        id: string
        loan: string
        amount: string
        receivedAt: Date
      }>>(`
        SELECT p.id, p.loan, p.amount::text, p."receivedAt"
        FROM ${s}"LoanPayment" p
        INNER JOIN ${s}"Loan" l ON p.loan = l.id
        WHERE p."receivedAt" <= $1::timestamp
          AND ${paymentsWhereClause}
      `, ...paymentsParams),
    ])

    // Build payments map
    const paymentsMap = new Map<string, PaymentForCV[]>()
    for (const payment of paymentsResult) {
      if (!paymentsMap.has(payment.loan)) {
        paymentsMap.set(payment.loan, [])
      }
      paymentsMap.get(payment.loan)!.push({
        id: payment.id,
        receivedAt: payment.receivedAt,
        amount: parseFloat(payment.amount),
      })
    }

    // Build a map of loanId -> locationId for easy lookup
    const loanLocationMap = new Map<string, string>()
    for (const loan of loansResult) {
      if (loan.leadLocationId) {
        loanLocationMap.set(loan.id, loan.leadLocationId)
      }
    }

    // Build lookups for ALL (location, week) combinations
    // This allows us to determine the route for each loan in EACH week based on that week's date
    const routeLookups: Array<{ locationId: string; date: Date }> = []
    const uniqueLocationIds = new Set(loanLocationMap.values())

    for (const locationId of uniqueLocationIds) {
      for (const week of completedWeeks) {
        // Use week.end as the reference date for route lookup
        routeLookups.push({
          locationId,
          date: week.end,
        })
      }
    }

    // Batch lookup historical routes using LocationHistoryService
    const historicalRouteMap = await this.locationHistoryService.getRoutesForLocationsAtDates(routeLookups)

    // Helper function to get route for a loan at a specific week
    const getRouteForLoanAtWeek = (loanId: string, week: WeekRange): { routeId: string; routeName: string } | null => {
      const locationId = loanLocationMap.get(loanId)
      if (!locationId) return null
      const key = `${locationId}:${week.end.toISOString()}`
      return historicalRouteMap.get(key) || null
    }

    // Collect all route names from the lookups
    const routeNames = new Map<string, string>()
    for (const routeInfo of historicalRouteMap.values()) {
      routeNames.set(routeInfo.routeId, routeInfo.routeName)
    }

    // Build a map of loanId -> routeId for FILTERING ONLY (using signDate for initial filter)
    // The actual weekly attribution will use getRouteForLoanAtWeek
    const loanRouteMapForFilter = new Map<string, string>()
    for (const loan of loansResult) {
      const locationId = loanLocationMap.get(loan.id)
      if (locationId) {
        // For initial filtering, use the last completed week's route
        const routeInfo = getRouteForLoanAtWeek(loan.id, lastCompletedWeek)
        if (routeInfo) {
          loanRouteMapForFilter.set(loan.id, routeInfo.routeId)
        }
      }
    }

    // Filter by routeIds if specified (using current week's route assignment)
    const filteredLoans = filters?.routeIds?.length
      ? loansResult.filter((loan) => {
          const routeId = loanRouteMapForFilter.get(loan.id)
          return routeId && filters.routeIds!.includes(routeId)
        })
      : loansResult

    // Convert loans to LoanForPortfolio format
    const loansForPortfolio = filteredLoans.map((loan) => {
      const rate = loan.rate ? parseFloat(loan.rate) : 0
      const requestedAmount = loan.requestedAmount ? parseFloat(loan.requestedAmount) : 0
      const totalDebt = requestedAmount * (1 + rate)

      return {
        id: loan.id,
        pendingAmountStored: loan.pendingAmountStored ? parseFloat(loan.pendingAmountStored) : 0,
        signDate: loan.signDate,
        finishedDate: loan.finishedDate,
        renewedDate: loan.renewedDate,
        badDebtDate: loan.badDebtDate,
        excludedByCleanup: loan.excludedByCleanup,
        previousLoan: loan.previousLoan,
        status: loan.status,
        rate,
        requestedAmount,
        totalPaid: loan.totalPaid ? parseFloat(loan.totalPaid) : 0,
        weekDuration: loan.weekDuration ?? 16,
        totalDebt,
      }
    })

    // Use the pre-built payments map (already populated from paymentsResult)
    const allPaymentsMap = paymentsMap

    // Calculate metrics per route
    // Each week, loans are attributed to the route based on that week's date (not signDate)
    const routeStats = new Map<string, {
      weeklyAlCorriente: number[]
      weeklyEnCV: number[]
      lastWeekActivos: number
    }>()

    // Process each completed week
    for (const week of completedWeeks) {
      // Filter loans active during this week
      const activeLoansThisWeek = loansForPortfolio.filter((loan) => {
        const signedBeforeWeekEnd = loan.signDate <= week.end
        const notFinishedBeforeWeekStart = loan.finishedDate === null || loan.finishedDate >= week.start
        const notRenewedBeforeWeekStart = loan.renewedDate === null || loan.renewedDate >= week.start
        const stillActiveAtWeekEnd = (loan.finishedDate === null || loan.finishedDate > week.end) &&
                                      (loan.renewedDate === null || loan.renewedDate > week.end)
        return signedBeforeWeekEnd && notFinishedBeforeWeekStart && notRenewedBeforeWeekStart && stillActiveAtWeekEnd
      })

      const isLastWeek = week.weekNumber === lastCompletedWeek.weekNumber

      // Group active loans by their route AT THIS WEEK (not signDate)
      const loansByRouteThisWeek = new Map<string, typeof loansForPortfolio>()
      for (const loan of activeLoansThisWeek) {
        const routeInfo = getRouteForLoanAtWeek(loan.id, week)
        if (routeInfo) {
          const routeId = routeInfo.routeId
          if (!loansByRouteThisWeek.has(routeId)) {
            loansByRouteThisWeek.set(routeId, [])
          }
          loansByRouteThisWeek.get(routeId)!.push(loan)
        }
      }

      // Calculate stats for each route this week
      for (const [routeId, routeLoans] of loansByRouteThisWeek) {
        if (routeLoans.length === 0) continue

        // Create payments map for these loans
        const routePaymentsMap = new Map<string, PaymentForCV[]>()
        for (const loan of routeLoans) {
          routePaymentsMap.set(loan.id, allPaymentsMap.get(loan.id) || [])
        }

        // Calculate CV status
        const status = countClientsStatus(routeLoans, routePaymentsMap, week, true)

        if (!routeStats.has(routeId)) {
          routeStats.set(routeId, {
            weeklyAlCorriente: [],
            weeklyEnCV: [],
            lastWeekActivos: 0,
          })
        }

        const stats = routeStats.get(routeId)!
        stats.weeklyAlCorriente.push(status.alCorriente)
        stats.weeklyEnCV.push(status.enCV)

        if (isLastWeek) {
          stats.lastWeekActivos = status.totalActivos
        }
      }
    }

    // Build result
    const result: { routeId: string; routeName: string; clientesTotal: number; pagandoPromedio: number; cvPromedio: number }[] = []

    for (const [routeId, stats] of routeStats) {
      if (stats.lastWeekActivos > 0) {
        const alCorrientePromedio = stats.weeklyAlCorriente.length > 0
          ? stats.weeklyAlCorriente.reduce((a, b) => a + b, 0) / stats.weeklyAlCorriente.length
          : 0
        const cvPromedio = stats.weeklyEnCV.length > 0
          ? stats.weeklyEnCV.reduce((a, b) => a + b, 0) / stats.weeklyEnCV.length
          : 0

        result.push({
          routeId,
          routeName: routeNames.get(routeId) || 'Sin ruta',
          clientesTotal: stats.lastWeekActivos,
          pagandoPromedio: Math.round(alCorrientePromedio * 100) / 100,
          cvPromedio: Math.round(cvPromedio * 100) / 100,
        })
      }
    }

    // Sort by clientesTotal descending
    return result.sort((a, b) => b.clientesTotal - a.clientesTotal)
  }

  /**
   * Gets active clients with their CV status
   * Uses the last completed week for CV calculation
   * Route is determined by lead's location at loan signDate (historical)
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

    // Build where clause without route filter (applied after historical lookup)
    const whereClause = this.buildActiveLoansWhereClause({
      ...filters,
      routeIds: undefined, // Route filter applied after historical lookup
    })

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
        leadRelation: {
          include: {
            personalDataRelation: {
              include: {
                addresses: {
                  take: 1,
                  select: { location: true },
                },
              },
            },
          },
        },
      },
    })

    // Build lookups for historical route determination
    const routeLookups: Array<{ locationId: string; date: Date; loanId: string }> = []
    for (const loan of loans) {
      const locationId = loan.leadRelation?.personalDataRelation?.addresses?.[0]?.location
      if (locationId) {
        routeLookups.push({
          locationId,
          date: loan.signDate,
          loanId: loan.id,
        })
      }
    }

    // Batch lookup historical routes using LocationHistoryService
    const historicalRouteMap = await this.locationHistoryService.getRoutesForLocationsAtDates(
      routeLookups.map((l) => ({ locationId: l.locationId, date: l.date }))
    )

    // Build a map of loanId -> route info for quick lookup
    const loanRouteMap = new Map<string, { routeId: string; routeName: string }>()
    for (const loan of loans) {
      const locationId = loan.leadRelation?.personalDataRelation?.addresses?.[0]?.location
      if (locationId) {
        const key = `${locationId}:${loan.signDate.toISOString()}`
        const routeInfo = historicalRouteMap.get(key)
        if (routeInfo) {
          loanRouteMap.set(loan.id, routeInfo)
        }
      }
    }

    // Filter by route if needed (using historical route)
    const filteredLoans = filters?.routeIds?.length
      ? loans.filter((loan) => {
          const routeInfo = loanRouteMap.get(loan.id)
          return routeInfo && filters.routeIds!.includes(routeInfo.routeId)
        })
      : loans

    // Also get last payment for "days since last payment" calculation
    const loanIds = filteredLoans.map((l) => l.id)
    const lastPayments = await this.prisma.loanPayment.findMany({
      where: {
        loan: { in: loanIds },
      },
      orderBy: { receivedAt: 'desc' },
      distinct: ['loan'],
    })
    const lastPaymentMap = new Map(lastPayments.map((p) => [p.loan, p]))

    const result: ActiveClientStatus[] = []

    for (const loan of filteredLoans) {
      const loanForPortfolio = this.toLoanForPortfolio(loan)
      const payments = this.toPaymentsForCV(loan.payments)

      const inCV = isInCarteraVencida(loanForPortfolio, payments, activeWeek)
      const lastPayment = lastPaymentMap.get(loan.id)

      let daysSinceLastPayment: number | null = null
      if (lastPayment) {
        const diffTime = Date.now() - lastPayment.receivedAt.getTime()
        daysSinceLastPayment = Math.floor(diffTime / (1000 * 60 * 60 * 24))
      }

      // Get route from historical lookup
      const routeInfo = loanRouteMap.get(loan.id)
      const routeName = routeInfo?.routeName || 'Sin ruta'

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
   *
   * OPTIMIZATION: Fetches all weeks data in parallel instead of sequentially
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

    // OPTIMIZATION: Fetch all weeks data in parallel
    const weeksData = await Promise.all(
      weeks.map(async (week) => {
        const loansWithLocality = await this.getLoansWithBorrowerLocality(week, filters)
        return { week, loansWithLocality, isCompleted: this.isWeekCompleted(week) }
      })
    )

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

    // Process each week's data (now in memory)
    for (const { week, loansWithLocality, isCompleted } of weeksData) {
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

      // Use isLoanActiveAtDate to check if loan was active at week end
      // This handles: signDate, finishedDate, renewedDate, excludedByCleanup
      if (!isLoanActiveAtDate(loanForPortfolio, referenceDate)) {
        continue
      }

      // Use calculateCVContribution (same as countClientsStatus) to determine CV status
      // This considers: surplus from previous weeks, partial payments (50% = 0.5 CV), grace period
      const cvContribution = calculateCVContribution(
        loanForPortfolio,
        payments,
        targetWeek,
        referenceDate
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
    // Route filtering is done in memory after historical route lookup
    const baseWhereClause: Record<string, unknown> = {
      signDate: { lte: weekRange.end },
      excludedByCleanup: null,
      AND: [
        { OR: [{ finishedDate: null }, { finishedDate: { gte: weekRange.start } }] },
        { OR: [{ renewedDate: null }, { renewedDate: { gte: weekRange.start } }] },
      ],
    }

    // Apply loan type filter (route filter is applied after historical lookup)
    if (filters?.loantypeIds?.length) {
      baseWhereClause.loantype = { in: filters.loantypeIds }
    }

    // Query 1: Get active loans for the week
    const activeLoans = await this.prisma.loan.findMany({
      where: baseWhereClause,
      include: {
        // Include lead (loanOfficer) to get their locality
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
        // Include loantype to get the rate for CV calculation
        loantypeRelation: true,
        // Include previous loan to determine if it's renovación or reintegro
        previousLoanRelation: {
          select: {
            finishedDate: true,
          },
        },
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
    const finishedLoansWhere: Record<string, unknown> = {
      excludedByCleanup: null,
      renewedDate: null, // Finished without renewal
      finishedDate: {
        gte: weekRange.start,
        lte: weekRange.end,
      },
      ...(filters?.loantypeIds?.length && { loantype: { in: filters.loantypeIds } }),
    }

    const finishedLoans = await this.prisma.loan.findMany({
      where: finishedLoansWhere,
      include: {
        // Include lead (loanOfficer) to get their locality
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
      },
    })

    // Build lookups for historical route determination
    const allLoans = [...activeLoans, ...finishedLoans]
    const routeLookups: Array<{ locationId: string; date: Date; loanId: string }> = []
    for (const loan of allLoans) {
      const locationId = loan.leadRelation?.personalDataRelation?.addresses?.[0]?.location
      if (locationId) {
        routeLookups.push({
          locationId,
          date: loan.signDate,
          loanId: loan.id,
        })
      }
    }

    // Batch lookup historical routes using LocationHistoryService
    const historicalRouteMap = await this.locationHistoryService.getRoutesForLocationsAtDates(
      routeLookups.map((l) => ({ locationId: l.locationId, date: l.date }))
    )

    // Build a map of loanId -> route info for quick lookup
    const loanRouteMap = new Map<string, { routeId: string; routeName: string }>()
    for (const loan of allLoans) {
      const locationId = loan.leadRelation?.personalDataRelation?.addresses?.[0]?.location
      if (locationId) {
        const key = `${locationId}:${loan.signDate.toISOString()}`
        const routeInfo = historicalRouteMap.get(key)
        if (routeInfo) {
          loanRouteMap.set(loan.id, routeInfo)
        }
      }
    }

    // Filter active loans by route if needed (using historical route)
    const filteredActiveLoans = filters?.routeIds?.length
      ? activeLoans.filter((loan) => {
          const routeInfo = loanRouteMap.get(loan.id)
          return routeInfo && filters.routeIds!.includes(routeInfo.routeId)
        })
      : activeLoans

    // Map active loans
    const result = filteredActiveLoans.map((loan) => {
      // Get locality from lead's address
      const address = loan.leadRelation?.personalDataRelation?.addresses?.[0]
      const location = address?.locationRelation

      // Get route from historical lookup
      const routeInfo = loanRouteMap.get(loan.id)
      const routeId = routeInfo?.routeId
      const routeName = routeInfo?.routeName

      // "Nuevo" = signed this week without a previous loan
      const isNew =
        loan.signDate >= weekRange.start &&
        loan.signDate <= weekRange.end &&
        !loan.previousLoan

      // Check if this is a loan with previousLoan signed this week
      const signedThisWeekWithPrevious =
        loan.signDate >= weekRange.start &&
        loan.signDate <= weekRange.end &&
        loan.previousLoan !== null

      // Determine if it's renovación or reintegro based on when previous loan finished
      // - Renovación: previous loan finished in the SAME week as this loan was signed
      // - Reintegro: previous loan finished in a DIFFERENT week (client came back later)
      let isRenewed = false
      let isReintegro = false

      if (signedThisWeekWithPrevious) {
        const previousFinishedDate = loan.previousLoanRelation?.finishedDate
        if (previousFinishedDate) {
          // Check if previous loan finished in the same week
          const finishedInSameWeek =
            previousFinishedDate >= weekRange.start &&
            previousFinishedDate <= weekRange.end

          if (finishedInSameWeek) {
            isRenewed = true  // Renovación: terminó y renovó en la misma semana
          } else {
            isReintegro = true  // Reintegro: regresa después de haber terminado antes
          }
        } else {
          // If we can't determine when previous finished, assume renovación
          isRenewed = true
        }
      }

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

    // Filter and add finished loans (for counting purposes, marked as not active)
    const filteredFinishedLoans = filters?.routeIds?.length
      ? finishedLoans.filter((loan) => {
          const routeInfo = loanRouteMap.get(loan.id)
          return routeInfo && filters.routeIds!.includes(routeInfo.routeId)
        })
      : finishedLoans

    for (const loan of filteredFinishedLoans) {
      // Skip if already in active loans (shouldn't happen with our filters)
      if (result.find(r => r.id === loan.id)) continue

      // Get locality from lead's address
      const address = loan.leadRelation?.personalDataRelation?.addresses?.[0]
      const location = address?.locationRelation

      // Get route from historical lookup
      const routeInfo = loanRouteMap.get(loan.id)
      const routeId = routeInfo?.routeId
      const routeName = routeInfo?.routeName

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
   * Gets the locationId for a lead (employee) from their primary address.
   * Returns null if the lead doesn't have an address.
   */
  private async getLeadLocationId(leadId: string): Promise<string | null> {
    const lead = await this.prisma.employee.findUnique({
      where: { id: leadId },
      include: {
        personalDataRelation: {
          include: {
            addresses: {
              take: 1,
              select: { location: true },
            },
          },
        },
      },
    })
    return lead?.personalDataRelation?.addresses[0]?.location ?? null
  }

  /**
   * Batch lookup: Gets locationIds for multiple leads.
   * Returns a Map<leadId, locationId>
   */
  private async getLeadLocationIds(leadIds: string[]): Promise<Map<string, string>> {
    if (leadIds.length === 0) {
      return new Map()
    }

    const leads = await this.prisma.employee.findMany({
      where: { id: { in: leadIds } },
      include: {
        personalDataRelation: {
          include: {
            addresses: {
              take: 1,
              select: { location: true },
            },
          },
        },
      },
    })

    const result = new Map<string, string>()
    for (const lead of leads) {
      const locationId = lead.personalDataRelation?.addresses[0]?.location
      if (locationId) {
        result.set(lead.id, locationId)
      }
    }
    return result
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
    // - Loans not excluded by cleanup
    // Build WHERE conditions for raw SQL
    // Route filtering is now done in memory after historical route lookup
    const conditions: string[] = [
      `l."signDate" <= $1`,
      `(l."finishedDate" IS NULL OR l."finishedDate" >= $2)`,
      `(l."renewedDate" IS NULL OR l."renewedDate" >= $2)`,
      `l."excludedByCleanup" IS NULL`,
    ]
    const params: unknown[] = [periodEnd, periodStart]
    let paramIndex = 3

    // Loan type filter (route filter is applied after historical lookup)
    if (filters?.loantypeIds?.length) {
      const ltPlaceholders = filters.loantypeIds.map((_, i) => `$${paramIndex + i}`).join(', ')
      conditions.push(`l.loantype IN (${ltPlaceholders})`)
      params.push(...filters.loantypeIds)
      paramIndex += filters.loantypeIds.length
    }

    const whereClause = conditions.join(' AND ')
    const s = this.schemaPrefix // Schema prefix for raw queries

    // Query 1: Loans with lead's locationId for historical route lookup
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
        previousLoanFinishedDate: Date | null
        status: string
        pendingAmountStored: string
        requestedAmount: string
        totalPaid: string
        excludedByCleanup: string | null
        cleanupDate: Date | null
        leadId: string | null
        leadLocationId: string | null
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
          prev."finishedDate" as "previousLoanFinishedDate",
          l.status,
          l."pendingAmountStored"::text,
          l."requestedAmount"::text,
          l."totalPaid"::text,
          l."excludedByCleanup",
          c."cleanupDate",
          l.lead as "leadId",
          a.location as "leadLocationId",
          lt.rate::text,
          lt."weekDuration",
          l."amountGived"::text,
          l."profitAmount"::text
        FROM ${s}"Loan" l
        LEFT JOIN ${s}"Loan" prev ON l."previousLoan" = prev.id
        LEFT JOIN ${s}"Loantype" lt ON l.loantype = lt.id
        LEFT JOIN ${s}"PortfolioCleanup" c ON l."excludedByCleanup" = c.id
        LEFT JOIN ${s}"Employee" e ON l.lead = e.id
        LEFT JOIN ${s}"PersonalData" pd ON e."personalData" = pd.id
        LEFT JOIN ${s}"Address" a ON pd.id = a."personalData"
        WHERE ${whereClause}
        ORDER BY l.id, a.id
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
        FROM ${s}"LoanPayment" p
        INNER JOIN ${s}"Loan" l ON p.loan = l.id
        WHERE p."receivedAt" <= $1
          AND l."signDate" <= $2
          AND (l."finishedDate" IS NULL OR l."finishedDate" >= $3)
          AND (l."renewedDate" IS NULL OR l."renewedDate" >= $3)
          AND l."excludedByCleanup" IS NULL
          ${filters?.loantypeIds?.length ? `AND l.loantype IN (${filters.loantypeIds.map((_, i) => `$${4 + i}`).join(', ')})` : ''}
      `, periodEnd, periodEnd, periodStart, ...(filters?.loantypeIds || [])),
    ])

    // Build lookups for historical route determination
    // Each loan's route is determined by the lead's location at the loan's signDate
    const routeLookups: Array<{ locationId: string; date: Date; loanId: string }> = []
    for (const loan of loansResult) {
      if (loan.leadLocationId) {
        routeLookups.push({
          locationId: loan.leadLocationId,
          date: loan.signDate,
          loanId: loan.id,
        })
      }
    }

    // Batch lookup historical routes using LocationHistoryService
    const historicalRouteMap = await this.locationHistoryService.getRoutesForLocationsAtDates(
      routeLookups.map((l) => ({ locationId: l.locationId, date: l.date }))
    )

    // Process loans
    const loans: LoanForPortfolio[] = []
    const routeInfoMap = new Map<string, { routeId: string; routeName: string }>()

    // Filter by route if needed (using historical route assignment)
    const filteredLoansResult = filters?.routeIds?.length
      ? loansResult.filter((loan) => {
          if (!loan.leadLocationId) return false
          const key = `${loan.leadLocationId}:${loan.signDate.toISOString()}`
          const routeInfo = historicalRouteMap.get(key)
          return routeInfo && filters.routeIds!.includes(routeInfo.routeId)
        })
      : loansResult

    for (const loan of filteredLoansResult) {
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
        previousLoanFinishedDate: loan.previousLoanFinishedDate,
        status: loan.status,
        requestedAmount, // Use the safe-parsed value from above
        amountGived: loan.amountGived ? parseFloat(loan.amountGived) : undefined,
        rate, // Use the safe-parsed value from above
        totalPaid: loan.totalPaid ? parseFloat(loan.totalPaid) : 0,
        weekDuration: loan.weekDuration ?? 16,
        totalDebt,
      })

      // Get route from historical lookup based on lead's location at signDate
      let routeId = 'unknown'
      let routeName = 'Sin ruta'
      if (loan.leadLocationId) {
        const key = `${loan.leadLocationId}:${loan.signDate.toISOString()}`
        const routeInfo = historicalRouteMap.get(key)
        if (routeInfo) {
          routeId = routeInfo.routeId
          routeName = routeInfo.routeName
        }
      }
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

    // Apply route filter - use lead's current route only
    if (filters?.routeIds?.length) {
      whereClause.leadRelation = {
        routes: {
          some: { id: { in: filters.routeIds } },
        },
      }
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

    // Calculate clients at the START of the period using the balance formula
    // clientesActivosInicio = totalClientesActivos - balance
    // This ensures mathematical consistency: incremento = nuevos - terminadosSinRenovar
    const clientesActivosInicio = status.totalActivos - clientBalance.balance

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
      // Fallback: Query route info from DB using historical lookup (used by getWeeklyReport)
      const loanIds = loans.map((l) => l.id)

      const dbLoans = await this.prisma.loan.findMany({
        where: { id: { in: loanIds } },
        include: {
          leadRelation: {
            include: {
              personalDataRelation: {
                include: {
                  addresses: {
                    take: 1,
                    select: { location: true },
                  },
                },
              },
            },
          },
        },
      })

      // Build lookups for historical route determination
      const routeLookups: Array<{ locationId: string; date: Date; loanId: string }> = []
      for (const dbLoan of dbLoans) {
        const locationId = dbLoan.leadRelation?.personalDataRelation?.addresses?.[0]?.location
        if (locationId) {
          routeLookups.push({
            locationId,
            date: dbLoan.signDate,
            loanId: dbLoan.id,
          })
        }
      }

      // Batch lookup historical routes using LocationHistoryService
      const historicalRouteMap = await this.locationHistoryService.getRoutesForLocationsAtDates(
        routeLookups.map((l) => ({ locationId: l.locationId, date: l.date }))
      )

      for (const dbLoan of dbLoans) {
        const locationId = dbLoan.leadRelation?.personalDataRelation?.addresses?.[0]?.location
        let routeId = 'unknown'
        let routeName = 'Sin ruta'

        if (locationId) {
          const key = `${locationId}:${dbLoan.signDate.toISOString()}`
          const routeInfo = historicalRouteMap.get(key)
          if (routeInfo) {
            routeId = routeInfo.routeId
            routeName = routeInfo.routeName
          }
        }

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
    // Build conditions for:
    // 1. Loans that ARE renewals (have previousLoan) signed in the period
    // 2. Loans that finished in the period (to count those without renewal)
    const conditions: string[] = [
      `(
        (l."previousLoan" IS NOT NULL AND l."signDate" >= $1 AND l."signDate" <= $2)
        OR (l."finishedDate" >= $1 AND l."finishedDate" <= $2)
      )`,
    ]
    const params: unknown[] = [periodStart, periodEnd]
    let paramIndex = 3

    // Route filter - use lead's current route only
    if (filters?.routeIds?.length) {
      const placeholders = filters.routeIds.map((_, i) => `$${paramIndex + i}`).join(', ')
      conditions.push(`EXISTS (
        SELECT 1 FROM "Employee" e
        JOIN "_RouteEmployees" re ON e.id = re."B"
        WHERE e.id = l.lead AND re."A" IN (${placeholders})
      )`)
      params.push(...filters.routeIds)
      paramIndex += filters.routeIds.length
    }

    if (filters?.loantypeIds?.length) {
      const placeholders = filters.loantypeIds.map((_, i) => `$${paramIndex + i}`).join(', ')
      conditions.push(`l.loantype IN (${placeholders})`)
      params.push(...filters.loantypeIds)
    }

    const s = this.schemaPrefix // Schema prefix for raw queries

    const loans = await this.prisma.$queryRawUnsafe<Array<{
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
        EXISTS (SELECT 1 FROM ${s}"Loan" l2 WHERE l2."previousLoan" = l.id) as "wasRenewed"
      FROM ${s}"Loan" l
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
      wasRenewed: loan.wasRenewed,
      requestedAmount: parseFloat(loan.requestedAmount),
      amountGived: parseFloat(loan.amountGived),
    }))

    return calculateRenovationKPIs(portfolioLoans, periodStart, periodEnd)
  }
}
