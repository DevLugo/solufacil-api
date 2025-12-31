import type { GraphQLContext } from '../context'
import {
  PortfolioReportService,
  type PortfolioFilters,
} from '../services/PortfolioReportService'
import { PortfolioReportPDFService } from '../services/PortfolioReportPDFService'
import type {
  PortfolioReport,
  WeekRange,
  ActiveClientStatus,
  LocalityReport,
  LocalityClientDetail,
  ClientCategory,
} from '@solufacil/business-logic'

// Helper to serialize WeekRange for GraphQL
function serializeWeekRange(week: WeekRange) {
  return {
    start: week.start,
    end: week.end,
    weekNumber: week.weekNumber,
    year: week.year,
  }
}

// Helper to serialize PortfolioReport for GraphQL
function serializePortfolioReport(report: PortfolioReport) {
  return {
    reportDate: report.reportDate,
    periodType: report.periodType,
    year: report.year,
    month: report.month,
    weekNumber: report.weekNumber,
    summary: {
      totalClientesActivos: report.summary.totalClientesActivos,
      clientesAlCorriente: report.summary.clientesAlCorriente,
      clientesEnCV: report.summary.clientesEnCV,
      promedioCV: report.summary.promedioCV,
      semanasCompletadas: report.summary.semanasCompletadas,
      totalSemanas: report.summary.totalSemanas,
      clientBalance: {
        nuevos: report.summary.clientBalance.nuevos,
        terminadosSinRenovar: report.summary.clientBalance.terminadosSinRenovar,
        renovados: report.summary.clientBalance.renovados,
        balance: report.summary.clientBalance.balance,
        trend: report.summary.clientBalance.trend,
      },
      comparison: report.summary.comparison
        ? {
            previousClientesActivos:
              report.summary.comparison.previousPeriod.clientesActivos,
            previousClientesEnCV:
              report.summary.comparison.previousPeriod.clientesEnCV,
            previousBalance: report.summary.comparison.previousPeriod.balance,
            cvChange: report.summary.comparison.cvChange,
            balanceChange: report.summary.comparison.balanceChange,
          }
        : null,
    },
    weeklyData: report.weeklyData.map((week) => ({
      weekRange: serializeWeekRange(week.weekRange),
      clientesActivos: week.clientesActivos,
      clientesEnCV: week.clientesEnCV,
      balance: week.balance,
      isCompleted: week.isCompleted,
    })),
    byLocation: report.byLocation.map((loc) => ({
      locationId: loc.locationId,
      locationName: loc.locationName,
      routeId: loc.routeId,
      routeName: loc.routeName,
      clientesActivos: loc.clientesActivos,
      clientesAlCorriente: loc.clientesAlCorriente,
      clientesEnCV: loc.clientesEnCV,
      balance: loc.balance,
    })),
    renovationKPIs: {
      totalRenovaciones: report.renovationKPIs.totalRenovaciones,
      totalCierresSinRenovar: report.renovationKPIs.totalCierresSinRenovar,
      tasaRenovacion: report.renovationKPIs.tasaRenovacion.toString(),
      tendencia: report.renovationKPIs.tendencia,
    },
  }
}

// Helper to serialize LocalityReport for GraphQL
function serializeLocalityReport(report: LocalityReport) {
  return {
    periodType: report.periodType,
    year: report.year,
    month: report.month,
    weekNumber: report.weekNumber,
    weeks: report.weeks.map(serializeWeekRange),
    localities: report.localities.map((locality) => ({
      localityId: locality.localityId,
      localityName: locality.localityName,
      routeId: locality.routeId,
      routeName: locality.routeName,
      weeklyData: locality.weeklyData.map((week) => ({
        weekRange: serializeWeekRange(week.weekRange),
        clientesActivos: week.clientesActivos,
        clientesAlCorriente: week.clientesAlCorriente,
        clientesEnCV: week.clientesEnCV,
        nuevos: week.nuevos,
        renovados: week.renovados,
        reintegros: week.reintegros,
        finalizados: week.finalizados,
        balance: week.balance,
        isCompleted: week.isCompleted,
      })),
      summary: {
        totalClientesActivos: locality.summary.totalClientesActivos,
        totalClientesAlCorriente: locality.summary.totalClientesAlCorriente,
        totalClientesEnCV: locality.summary.totalClientesEnCV,
        totalNuevos: locality.summary.totalNuevos,
        totalRenovados: locality.summary.totalRenovados,
        totalReintegros: locality.summary.totalReintegros,
        totalFinalizados: locality.summary.totalFinalizados,
        balance: locality.summary.balance,
        alCorrientePromedio: locality.summary.alCorrientePromedio,
        cvPromedio: locality.summary.cvPromedio,
        porcentajePagando: locality.summary.porcentajePagando,
      },
    })),
    totals: {
      totalClientesActivos: report.totals.totalClientesActivos,
      totalClientesAlCorriente: report.totals.totalClientesAlCorriente,
      totalClientesEnCV: report.totals.totalClientesEnCV,
      totalNuevos: report.totals.totalNuevos,
      totalRenovados: report.totals.totalRenovados,
      totalReintegros: report.totals.totalReintegros,
      totalFinalizados: report.totals.totalFinalizados,
      balance: report.totals.balance,
      alCorrientePromedio: report.totals.alCorrientePromedio,
      cvPromedio: report.totals.cvPromedio,
      porcentajePagando: report.totals.porcentajePagando,
    },
  }
}

export const portfolioReportResolvers = {
  Query: {
    portfolioReportWeekly: async (
      _parent: unknown,
      args: {
        year: number
        weekNumber: number
        filters?: PortfolioFilters
      },
      context: GraphQLContext
    ) => {
      const service = new PortfolioReportService(context.prisma)
      const report = await service.getWeeklyReport(
        args.year,
        args.weekNumber,
        args.filters || undefined
      )
      return serializePortfolioReport(report)
    },

    portfolioReportMonthly: async (
      _parent: unknown,
      args: {
        year: number
        month: number
        filters?: PortfolioFilters
      },
      context: GraphQLContext
    ) => {
      const service = new PortfolioReportService(context.prisma)
      const report = await service.getMonthlyReport(
        args.year,
        args.month,
        args.filters || undefined
      )
      return serializePortfolioReport(report)
    },

    portfolioRouteKPIs: async (
      _parent: unknown,
      args: {
        year: number
        month: number
        filters?: PortfolioFilters
      },
      context: GraphQLContext
    ) => {
      const service = new PortfolioReportService(context.prisma)
      return service.getRouteKPIs(
        args.year,
        args.month,
        args.filters || undefined
      )
    },

    activeClientsWithCVStatus: async (
      _parent: unknown,
      args: { filters?: PortfolioFilters },
      context: GraphQLContext
    ) => {
      const service = new PortfolioReportService(context.prisma)
      const clients = await service.getActiveClientsWithCVStatus(
        args.filters || undefined
      )

      return clients.map((client) => ({
        loanId: client.loanId,
        borrowerId: client.borrowerId,
        clientName: client.clientName,
        pendingAmount: client.pendingAmount.toString(),
        cvStatus: client.cvStatus,
        daysSinceLastPayment: client.daysSinceLastPayment,
        locationName: client.locationName,
        routeName: client.routeName,
      }))
    },

    currentActiveWeek: async (
      _parent: unknown,
      _args: unknown,
      context: GraphQLContext
    ) => {
      const service = new PortfolioReportService(context.prisma)
      const week = service.getCurrentActiveWeek()
      return serializeWeekRange(week)
    },

    portfolioByLocality: async (
      _parent: unknown,
      args: {
        year: number
        month: number
        filters?: PortfolioFilters
      },
      context: GraphQLContext
    ) => {
      const service = new PortfolioReportService(context.prisma)
      const report = await service.getLocalityReport(
        args.year,
        args.month,
        args.filters || undefined
      )
      return serializeLocalityReport(report)
    },

    localityClients: async (
      _parent: unknown,
      args: {
        localityId: string
        year: number
        month: number
        weekNumber?: number
        category?: ClientCategory
      },
      context: GraphQLContext
    ) => {
      const service = new PortfolioReportService(context.prisma)
      const clients = await service.getLocalityClients(
        args.localityId,
        args.year,
        args.month,
        args.weekNumber,
        args.category
      )
      return clients.map((client) => ({
        loanId: client.loanId,
        clientName: client.clientName,
        clientCode: client.clientCode,
        amountGived: client.amountGived.toString(),
        pendingAmount: client.pendingAmount.toString(),
        signDate: client.signDate,
        cvStatus: client.cvStatus,
        daysSinceLastPayment: client.daysSinceLastPayment,
        loanType: client.loanType,
        category: client.category,
        expectedWeekly: client.expectedWeekly.toString(),
        paidThisWeek: client.paidThisWeek.toString(),
      }))
    },
  },

  Mutation: {
    generatePortfolioReportPDF: async (
      _parent: unknown,
      args: {
        periodType: 'WEEKLY' | 'MONTHLY'
        year: number
        month?: number
        weekNumber?: number
        filters?: PortfolioFilters
      },
      context: GraphQLContext
    ) => {
      const pdfService = new PortfolioReportPDFService(context.prisma)
      const result = await pdfService.generatePDF({
        periodType: args.periodType,
        year: args.year,
        month: args.month,
        weekNumber: args.weekNumber,
        filters: args.filters || undefined,
      })

      return {
        success: result.success,
        base64: result.base64,
        filename: result.filename,
        generatedAt: result.generatedAt,
        error: result.error,
      }
    },
  },
}
