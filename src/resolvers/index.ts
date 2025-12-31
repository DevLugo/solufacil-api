import { scalars } from '@solufacil/graphql-schema'
import { authResolvers } from './auth'
import { userResolvers } from './users'
import { employeeResolvers } from './employees'
import { borrowerResolvers } from './borrowers'
import { loantypeResolvers } from './loantypes'
import { loanResolvers } from './loans'
import { paymentResolvers } from './payments'
import { transactionResolvers } from './transactions'
import { accountResolvers } from './accounts'
import { routeResolvers } from './routes'
import { reportResolvers } from './reports'
import { portfolioReportResolvers } from './portfolioReport'
import { portfolioCleanupResolvers } from './portfolioCleanup'
import { documentResolvers } from './documents'
import { personalDataResolvers } from './personalData'
import { clientResolvers } from './clients'
import { leadersResolvers } from './leaders'
import { telegramResolvers } from './telegram'
import { bankIncomeResolvers } from './bankIncome'
import { deadDebtResolvers } from './deadDebt'
import { batchTransferResolvers } from './batchTransfer'
import { bulkDateMigrationResolvers } from './bulkDateMigration'
import { badDebtClientsResolvers } from './badDebtClients'

export const resolvers = {
  ...scalars,

  Query: {
    ...authResolvers.Query,
    ...userResolvers.Query,
    ...employeeResolvers.Query,
    ...borrowerResolvers.Query,
    ...loantypeResolvers.Query,
    ...loanResolvers.Query,
    ...paymentResolvers.Query,
    ...transactionResolvers.Query,
    ...accountResolvers.Query,
    ...routeResolvers.Query,
    ...reportResolvers.Query,
    ...portfolioReportResolvers.Query,
    ...portfolioCleanupResolvers.Query,
    ...documentResolvers.Query,
    ...personalDataResolvers.Query,
    ...clientResolvers.Query,
    ...leadersResolvers.Query,
    ...telegramResolvers.Query,
    ...bankIncomeResolvers.Query,
    ...deadDebtResolvers.Query,
    ...bulkDateMigrationResolvers.Query,
    ...badDebtClientsResolvers.Query,
  },

  Mutation: {
    ...authResolvers.Mutation,
    ...userResolvers.Mutation,
    ...employeeResolvers.Mutation,
    ...borrowerResolvers.Mutation,
    ...loantypeResolvers.Mutation,
    ...loanResolvers.Mutation,
    ...paymentResolvers.Mutation,
    ...transactionResolvers.Mutation,
    ...accountResolvers.Mutation,
    ...routeResolvers.Mutation,
    ...portfolioReportResolvers.Mutation,
    ...portfolioCleanupResolvers.Mutation,
    ...documentResolvers.Mutation,
    ...personalDataResolvers.Mutation,
    ...leadersResolvers.Mutation,
    ...telegramResolvers.Mutation,
    ...deadDebtResolvers.Mutation,
    ...batchTransferResolvers.Mutation,
    ...bulkDateMigrationResolvers.Mutation,
  },

  // Type resolvers
  User: userResolvers.User,
  Employee: employeeResolvers.Employee,
  EmployeeWithStats: routeResolvers.EmployeeWithStats,
  Borrower: borrowerResolvers.Borrower,
  Loan: loanResolvers.Loan,
  LoanPayment: paymentResolvers.LoanPayment,
  LeadPaymentReceived: paymentResolvers.LeadPaymentReceived,
  Transaction: transactionResolvers.Transaction,
  AccountEntry: transactionResolvers.AccountEntry,
  Account: accountResolvers.Account,
  Route: routeResolvers.Route,
  Location: routeResolvers.Location,
  Municipality: routeResolvers.Municipality,
  State: routeResolvers.State,
  DocumentPhoto: documentResolvers.DocumentPhoto,
  PersonalData: personalDataResolvers.PersonalData,
  Address: personalDataResolvers.Address,
  Phone: personalDataResolvers.Phone,
  PortfolioCleanup: portfolioCleanupResolvers.PortfolioCleanup,
  TelegramUser: telegramResolvers.TelegramUser,
  ReportConfig: telegramResolvers.ReportConfig,
  ReportExecutionLog: telegramResolvers.ReportExecutionLog,
  DocumentWithNotificationStatus: telegramResolvers.DocumentWithNotificationStatus,
}
