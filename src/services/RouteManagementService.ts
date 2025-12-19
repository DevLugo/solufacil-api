import type { PrismaClient } from '@solufacil/database'
import { getWeeksInMonth, countClientsStatus, type WeekRange } from '@solufacil/business-logic'
import { PortfolioReportService, type PortfolioFilters } from './PortfolioReportService'

/**
 * Route with calculated statistics
 * Note: employees array contains Prisma types with personalDataRelation
 * GraphQL resolvers will automatically map personalDataRelation -> personalData
 */
export interface RouteWithStats {
  routeId: string
  routeName: string
  totalActivos: number
  enCV: number
  alCorriente: number
  employees: any[] // Let GraphQL resolvers handle the mapping
}

/**
 * Service for managing routes and calculating route statistics
 * Reuses portfolio calculation logic for consistency
 */
export class RouteManagementService {
  private portfolioService: PortfolioReportService

  constructor(private prisma: PrismaClient) {
    this.portfolioService = new PortfolioReportService(prisma)
  }

  /**
   * Maps employees to include their calculated statistics
   * Filters out invalid personalData relations
   */
  private mapEmployeesWithStats(
    employees: any[],
    loansByLead: Map<string, Set<string>>,
    loans: any[],
    paymentsMap: Map<string, any[]>,
    lastCompletedWeek: WeekRange | null
  ) {
    return employees.map((employee) => {
      // Get loan IDs for this lead
      const employeeLoanIds = loansByLead.get(employee.id) || new Set()

      // Filter loans for this specific lead
      const employeeLoans = loans.filter((loan) => employeeLoanIds.has(loan.id))

      // Calculate stats for this employee's loans
      const employeeStats = lastCompletedWeek
        ? countClientsStatus(employeeLoans, paymentsMap, lastCompletedWeek)
        : { totalActivos: 0, enCV: 0, alCorriente: 0 }

      // Only include personalDataRelation if it has valid data
      const hasValidPersonalData = employee.personalDataRelation?.id != null

      return {
        id: employee.id,
        type: employee.type,
        personalData: employee.personalData,
        personalDataRelation: hasValidPersonalData ? employee.personalDataRelation : null,
        activos: employeeStats.totalActivos,
        enCV: employeeStats.enCV,
        alCorriente: employeeStats.alCorriente,
      }
    })
  }

  /**
   * Gets all routes with calculated statistics for a given period
   * Uses the same calculation logic as the portfolio report (DRY principle)
   *
   * @param year - Year for the report period
   * @param month - Month for the report period (1-12)
   * @returns Array of routes with statistics
   */
  async getRoutesWithStats(year: number, month: number): Promise<RouteWithStats[]> {
    // Get weeks in the specified month (month is 1-indexed, so subtract 1 for JS Date)
    const weeks = getWeeksInMonth(year, month - 1)

    // Get the last completed week for CV calculation
    // A week is completed when we're past Sunday 23:59:59
    const lastCompletedWeek = weeks.filter((w) => new Date() > w.end).pop()

    if (!lastCompletedWeek) {
      // No completed weeks yet in this period - return routes with zero stats
      const routes = await this.prisma.route.findMany({
        include: {
          employees: {
            where: {
              type: 'LEAD',
            },
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
        orderBy: { name: 'asc' },
      })

      const emptyLoansByLead = new Map<string, Set<string>>()
      const emptyLoans: any[] = []
      const emptyPaymentsMap = new Map<string, any[]>()

      return routes.map((route) => ({
        routeId: route.id,
        routeName: route.name,
        totalActivos: 0,
        enCV: 0,
        alCorriente: 0,
        employees: this.mapEmployeesWithStats(
          route.employees,
          emptyLoansByLead,
          emptyLoans,
          emptyPaymentsMap,
          null
        ),
      }))
    }

    // Fetch all routes with their LEAD employees
    const routes = await this.prisma.route.findMany({
      include: {
        employees: {
          where: {
            type: 'LEAD',
          },
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
      orderBy: { name: 'asc' },
    })

    // Calculate stats for each route using SHARED portfolio logic
    const routesWithStats = await Promise.all(
      routes.map(async (route) => {
        const filters: PortfolioFilters = {
          routeIds: [route.id],
        }

        // Get active loans and payments for this route
        const { loans, paymentsMap } = await this.portfolioService.getActiveLoansWithPayments(
          lastCompletedWeek,
          filters
        )

        // Reuse exact same calculation logic as portfolio report (DRY principle)
        const stats = countClientsStatus(loans, paymentsMap, lastCompletedWeek)

        // Get raw loans with lead information to group by employee
        const dbLoans = await this.prisma.loan.findMany({
          where: {
            pendingAmountStored: { gt: 0 },
            badDebtDate: null,
            excludedByCleanup: null,
            renewedDate: null,
            finishedDate: null,
            OR: [
              { snapshotRouteId: route.id },
              {
                leadRelation: {
                  routes: {
                    some: { id: route.id },
                  },
                },
              },
            ],
          },
          select: {
            id: true,
            lead: true,
          },
        })

        // Group loans by lead ID
        const loansByLead = new Map<string, Set<string>>()
        for (const loan of dbLoans) {
          if (loan.lead) {
            if (!loansByLead.has(loan.lead)) {
              loansByLead.set(loan.lead, new Set())
            }
            loansByLead.get(loan.lead)!.add(loan.id)
          }
        }

        // Calculate stats per employee using shared mapping logic
        const employeesWithStats = this.mapEmployeesWithStats(
          route.employees,
          loansByLead,
          loans,
          paymentsMap,
          lastCompletedWeek
        )

        return {
          routeId: route.id,
          routeName: route.name,
          totalActivos: stats.totalActivos,
          enCV: stats.enCV,
          alCorriente: stats.alCorriente,
          employees: employeesWithStats,
        }
      })
    )

    return routesWithStats
  }
}
