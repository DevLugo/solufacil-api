import type { GraphQLContext } from '../context'
import { ReportService } from '../services/ReportService'

export const reportResolvers = {
  Query: {
    financialReport: async (
      _parent: unknown,
      args: { routeIds: string[]; year: number; month: number },
      context: GraphQLContext
    ) => {
      const reportService = new ReportService(context.prisma)
      const report = await reportService.getFinancialReport(
        args.routeIds,
        args.year,
        args.month
      )

      return {
        summary: {
          activeLoans: report.summary.activeLoans,
          activeLoansBreakdown: report.summary.activeLoansBreakdown,
          totalPortfolio: report.summary.totalPortfolio.toString(),
          totalPaid: report.summary.totalPaid.toString(),
          pendingAmount: report.summary.pendingAmount.toString(),
          averagePayment: report.summary.averagePayment.toString(),
        },
        weeklyData: report.weeklyData.map((week) => ({
          week: week.week,
          date: week.date,
          loansGranted: week.loansGranted,
          paymentsReceived: week.paymentsReceived.toString(),
          paymentsCount: week.paymentsCount,
          expectedPayments: week.expectedPayments.toString(),
          recoveryRate: week.recoveryRate.toString(),
        })),
        comparisonData: report.comparisonData
          ? {
              previousMonth: {
                activeLoans: report.comparisonData.previousMonth.activeLoans,
                activeLoansBreakdown: report.comparisonData.previousMonth.activeLoansBreakdown,
                totalPortfolio: report.comparisonData.previousMonth.totalPortfolio.toString(),
                totalPaid: report.comparisonData.previousMonth.totalPaid.toString(),
                pendingAmount: report.comparisonData.previousMonth.pendingAmount.toString(),
                averagePayment: report.comparisonData.previousMonth.averagePayment.toString(),
              },
              growth: report.comparisonData.growth.toString(),
              trend: report.comparisonData.trend,
            }
          : null,
        performanceMetrics: {
          recoveryRate: report.performanceMetrics.recoveryRate.toString(),
          averageTicket: report.performanceMetrics.averageTicket.toString(),
          activeLoansCount: report.performanceMetrics.activeLoansCount,
          finishedLoansCount: report.performanceMetrics.finishedLoansCount,
        },
      }
    },

    badDebtByMonth: async (
      _parent: unknown,
      args: { year: number; month: number },
      context: GraphQLContext
    ) => {
      const reportService = new ReportService(context.prisma)
      const data = await reportService.getBadDebtByMonth(args.year, args.month)

      return data.map((item) => ({
        routeId: item.routeId,
        routeName: item.routeName,
        loanCount: item.loanCount,
        totalAmount: item.totalAmount.toString(),
      }))
    },

    badDebtSummary: async (
      _parent: unknown,
      _args: unknown,
      context: GraphQLContext
    ) => {
      const reportService = new ReportService(context.prisma)
      const summary = await reportService.getBadDebtSummary()

      return {
        totalLoans: summary.totalLoans,
        totalAmount: summary.totalAmount.toString(),
        byRoute: summary.byRoute.map((item) => ({
          routeId: item.routeId,
          routeName: item.routeName,
          loanCount: item.loanCount,
          totalAmount: item.totalAmount.toString(),
        })),
      }
    },

    getFinancialReportAnnual: async (
      _parent: unknown,
      args: { routeIds: string[]; year: number },
      context: GraphQLContext
    ) => {
      const reportService = new ReportService(context.prisma)
      const report = await reportService.getFinancialReportAnnual(args.routeIds, args.year)

      return {
        routes: report.routes,
        year: report.year,
        months: report.months,
        data: report.data.map((monthData) => ({
          month: monthData.month,
          totalExpenses: monthData.totalExpenses.toString(),
          generalExpenses: monthData.generalExpenses.toString(),
          nomina: monthData.nomina.toString(),
          comissions: monthData.comissions.toString(),
          nominaInterna: monthData.nominaInterna.toString(),
          salarioExterno: monthData.salarioExterno.toString(),
          viaticos: monthData.viaticos.toString(),
          travelExpenses: monthData.travelExpenses.toString(),
          tokaGasolina: monthData.tokaGasolina.toString(),
          cashGasolina: monthData.cashGasolina.toString(),
          totalGasolina: monthData.totalGasolina.toString(),
          badDebtAmount: monthData.badDebtAmount.toString(),
          badDebtCapital: monthData.badDebtCapital.toString(),
          badDebtProfit: monthData.badDebtProfit.toString(),
          incomes: monthData.incomes.toString(),
          operationalProfit: monthData.operationalProfit.toString(),
          operationalProfitCapitalOnly: monthData.operationalProfitCapitalOnly.toString(),
          profitPercentage: monthData.profitPercentage.toString(),
          gainPerPayment: monthData.gainPerPayment.toString(),
          activeWeeks: monthData.activeWeeks,
          weeklyAverageProfit: monthData.weeklyAverageProfit.toString(),
          weeklyAverageExpenses: monthData.weeklyAverageExpenses.toString(),
          weeklyAverageIncome: monthData.weeklyAverageIncome.toString(),
          loanDisbursements: monthData.loanDisbursements.toString(),
          carteraActiva: monthData.carteraActiva,
          carteraVencida: monthData.carteraVencida,
          carteraMuerta: monthData.carteraMuerta.toString(),
          renovados: monthData.renovados,
          totalIncomingCash: monthData.totalIncomingCash.toString(),
          capitalReturn: monthData.capitalReturn.toString(),
          profitReturn: monthData.profitReturn.toString(),
          operationalCashUsed: monthData.operationalCashUsed.toString(),
          totalInvestment: monthData.totalInvestment.toString(),
          availableCash: monthData.availableCash.toString(),
          paymentsCount: monthData.paymentsCount,
        })),
        annualWeeklyAverageProfit: report.annualWeeklyAverageProfit.toString(),
        annualWeeklyAverageExpenses: report.annualWeeklyAverageExpenses.toString(),
        annualWeeklyAverageIncome: report.annualWeeklyAverageIncome.toString(),
        totalActiveWeeks: report.totalActiveWeeks,
      }
    },
  },
}
