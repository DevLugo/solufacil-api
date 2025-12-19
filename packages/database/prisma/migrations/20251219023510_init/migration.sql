-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'NORMAL', 'CAPTURA', 'DOCUMENT_REVIEWER');

-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('ROUTE_LEAD', 'LEAD', 'ROUTE_ASSISTENT');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'FINISHED', 'RENOVATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MONEY_TRANSFER');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'INVESTMENT');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('BANK', 'OFFICE_CASH_FUND', 'EMPLOYEE_CASH_FUND', 'PREPAID_GAS', 'TRAVEL_EXPENSES');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INE', 'DOMICILIO', 'PAGARE', 'OTRO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalData" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL DEFAULT '',
    "clientCode" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Phone" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "personalData" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Phone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "street" TEXT NOT NULL DEFAULT '',
    "exteriorNumber" TEXT NOT NULL DEFAULT '',
    "interiorNumber" TEXT NOT NULL DEFAULT '',
    "postalCode" TEXT NOT NULL DEFAULT '',
    "references" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL,
    "personalData" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "oldId" TEXT,
    "type" "EmployeeType" NOT NULL,
    "personalData" TEXT NOT NULL,
    "user" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Borrower" (
    "id" TEXT NOT NULL,
    "loanFinishedCount" INTEGER NOT NULL DEFAULT 0,
    "personalData" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Borrower_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loantype" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "weekDuration" INTEGER NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "loanPaymentComission" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "loanGrantedComission" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loantype_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "oldId" TEXT,
    "requestedAmount" DECIMAL(10,2) NOT NULL,
    "amountGived" DECIMAL(10,2) NOT NULL,
    "signDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedDate" TIMESTAMP(3),
    "renewedDate" TIMESTAMP(3),
    "badDebtDate" TIMESTAMP(3),
    "isDeceased" BOOLEAN NOT NULL DEFAULT false,
    "profitAmount" DECIMAL(10,2) NOT NULL,
    "totalDebtAcquired" DECIMAL(12,2) NOT NULL,
    "expectedWeeklyPayment" DECIMAL(12,2) NOT NULL,
    "totalPaid" DECIMAL(12,2) NOT NULL,
    "pendingAmountStored" DECIMAL(12,2) NOT NULL,
    "comissionAmount" DECIMAL(18,4) NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "borrower" TEXT NOT NULL,
    "loantype" TEXT NOT NULL,
    "grantor" TEXT,
    "lead" TEXT,
    "snapshotLeadId" TEXT,
    "snapshotLeadAssignedAt" TIMESTAMP(3),
    "snapshotRouteId" TEXT,
    "snapshotRouteName" TEXT NOT NULL DEFAULT '',
    "previousLoan" TEXT,
    "excludedByCleanup" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanPayment" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "comission" DECIMAL(18,4) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "type" TEXT NOT NULL,
    "oldLoanId" TEXT,
    "loan" TEXT NOT NULL,
    "leadPaymentReceived" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPaymentReceived" (
    "id" TEXT NOT NULL,
    "expectedAmount" DECIMAL(18,4) NOT NULL,
    "paidAmount" DECIMAL(18,4) NOT NULL,
    "cashPaidAmount" DECIMAL(18,4) NOT NULL,
    "bankPaidAmount" DECIMAL(18,4) NOT NULL,
    "falcoAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paymentStatus" TEXT NOT NULL,
    "lead" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPaymentReceived_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FalcoCompensatoryPayment" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "leadPaymentReceived" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FalcoCompensatoryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionPayment" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "loan" TEXT NOT NULL,
    "employee" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPaymentType" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "LeadPaymentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "TransactionType" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "incomeSource" TEXT,
    "expenseSource" TEXT,
    "snapshotLeadId" TEXT NOT NULL DEFAULT '',
    "snapshotRouteId" TEXT NOT NULL DEFAULT '',
    "expenseGroupId" TEXT,
    "profitAmount" DECIMAL(10,2) DEFAULT 0,
    "returnToCapital" DECIMAL(10,2) DEFAULT 0,
    "loan" TEXT,
    "loanPayment" TEXT,
    "sourceAccount" TEXT NOT NULL,
    "destinationAccount" TEXT,
    "route" TEXT,
    "lead" TEXT,
    "leadPaymentReceived" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "type" "AccountType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "municipality" TEXT NOT NULL,
    "route" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Municipality" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Municipality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "State" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "State_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPhoto" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "photoUrl" TEXT NOT NULL DEFAULT '',
    "publicId" TEXT NOT NULL DEFAULT '',
    "documentType" "DocumentType" NOT NULL,
    "isError" BOOLEAN NOT NULL DEFAULT false,
    "errorDescription" TEXT NOT NULL DEFAULT '',
    "isMissing" BOOLEAN NOT NULL DEFAULT false,
    "personalData" TEXT,
    "loan" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramUser" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "username" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportsReceived" INTEGER NOT NULL DEFAULT 0,
    "isInRecipientsList" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "platformUser" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "reportType" TEXT NOT NULL,
    "schedule" JSONB DEFAULT '{"days": [], "hour": "09", "timezone": "America/Mexico_City"}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportExecutionLog" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "executionType" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "errorDetails" TEXT NOT NULL DEFAULT '',
    "recipientsCount" INTEGER,
    "successfulDeliveries" INTEGER,
    "failedDeliveries" INTEGER,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "duration" INTEGER,
    "cronExpression" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT '',
    "reportConfig" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentNotificationLog" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL DEFAULT '',
    "documentType" TEXT NOT NULL DEFAULT '',
    "personalDataId" TEXT NOT NULL DEFAULT '',
    "personName" TEXT NOT NULL DEFAULT '',
    "loanId" TEXT NOT NULL DEFAULT '',
    "routeId" TEXT NOT NULL DEFAULT '',
    "routeName" TEXT NOT NULL DEFAULT '',
    "localityName" TEXT NOT NULL DEFAULT '',
    "routeLeadId" TEXT NOT NULL DEFAULT '',
    "routeLeadName" TEXT NOT NULL DEFAULT '',
    "routeLeadUserId" TEXT NOT NULL DEFAULT '',
    "telegramUserId" TEXT NOT NULL DEFAULT '',
    "telegramChatId" TEXT NOT NULL DEFAULT '',
    "telegramUsername" TEXT NOT NULL DEFAULT '',
    "issueType" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "messageContent" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "telegramResponse" TEXT NOT NULL DEFAULT '',
    "telegramErrorCode" INTEGER,
    "telegramErrorMessage" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "responseTimeMs" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentNotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "modelName" TEXT NOT NULL DEFAULT '',
    "recordId" TEXT NOT NULL DEFAULT '',
    "userName" TEXT NOT NULL DEFAULT '',
    "userEmail" TEXT NOT NULL DEFAULT '',
    "userRole" TEXT NOT NULL DEFAULT '',
    "sessionId" TEXT NOT NULL DEFAULT '',
    "ipAddress" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "previousValues" JSONB,
    "newValues" JSONB,
    "changedFields" JSONB,
    "description" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB,
    "user" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioCleanup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "cleanupDate" TIMESTAMP(3) NOT NULL,
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "excludedLoansCount" INTEGER NOT NULL,
    "excludedAmount" DECIMAL(18,4) NOT NULL,
    "route" TEXT,
    "executedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioCleanup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RouteEmployees" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RouteEmployees_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_LoanCollaterals" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_LoanCollaterals_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_RouteAccounts" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RouteAccounts_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ReportConfigRoutes" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ReportConfigRoutes_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ReportConfigRecipients" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ReportConfigRecipients_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalData_clientCode_key" ON "PersonalData"("clientCode");

-- CreateIndex
CREATE INDEX "PersonalData_clientCode_idx" ON "PersonalData"("clientCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_oldId_key" ON "Employee"("oldId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_personalData_key" ON "Employee"("personalData");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_user_key" ON "Employee"("user");

-- CreateIndex
CREATE INDEX "Employee_type_idx" ON "Employee"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Borrower_personalData_key" ON "Borrower"("personalData");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_oldId_key" ON "Loan"("oldId");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_previousLoan_key" ON "Loan"("previousLoan");

-- CreateIndex
CREATE INDEX "Loan_status_idx" ON "Loan"("status");

-- CreateIndex
CREATE INDEX "Loan_borrower_idx" ON "Loan"("borrower");

-- CreateIndex
CREATE INDEX "Loan_lead_idx" ON "Loan"("lead");

-- CreateIndex
CREATE INDEX "Loan_signDate_idx" ON "Loan"("signDate");

-- CreateIndex
CREATE INDEX "Loan_badDebtDate_idx" ON "Loan"("badDebtDate");

-- CreateIndex
CREATE INDEX "Loan_loantype_idx" ON "Loan"("loantype");

-- CreateIndex
CREATE INDEX "Loan_grantor_idx" ON "Loan"("grantor");

-- CreateIndex
CREATE INDEX "Loan_previousLoan_idx" ON "Loan"("previousLoan");

-- CreateIndex
CREATE INDEX "Loan_excludedByCleanup_idx" ON "Loan"("excludedByCleanup");

-- CreateIndex
CREATE INDEX "LoanPayment_loan_idx" ON "LoanPayment"("loan");

-- CreateIndex
CREATE INDEX "LoanPayment_receivedAt_idx" ON "LoanPayment"("receivedAt");

-- CreateIndex
CREATE INDEX "LoanPayment_leadPaymentReceived_idx" ON "LoanPayment"("leadPaymentReceived");

-- CreateIndex
CREATE INDEX "LeadPaymentReceived_lead_idx" ON "LeadPaymentReceived"("lead");

-- CreateIndex
CREATE INDEX "LeadPaymentReceived_agent_idx" ON "LeadPaymentReceived"("agent");

-- CreateIndex
CREATE INDEX "FalcoCompensatoryPayment_leadPaymentReceived_idx" ON "FalcoCompensatoryPayment"("leadPaymentReceived");

-- CreateIndex
CREATE INDEX "CommissionPayment_loan_idx" ON "CommissionPayment"("loan");

-- CreateIndex
CREATE INDEX "CommissionPayment_employee_idx" ON "CommissionPayment"("employee");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_loan_idx" ON "Transaction"("loan");

-- CreateIndex
CREATE INDEX "Transaction_loanPayment_idx" ON "Transaction"("loanPayment");

-- CreateIndex
CREATE INDEX "Transaction_sourceAccount_idx" ON "Transaction"("sourceAccount");

-- CreateIndex
CREATE INDEX "Transaction_destinationAccount_idx" ON "Transaction"("destinationAccount");

-- CreateIndex
CREATE INDEX "Transaction_route_idx" ON "Transaction"("route");

-- CreateIndex
CREATE INDEX "Transaction_lead_idx" ON "Transaction"("lead");

-- CreateIndex
CREATE INDEX "Transaction_leadPaymentReceived_idx" ON "Transaction"("leadPaymentReceived");

-- CreateIndex
CREATE INDEX "Account_type_idx" ON "Account"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE INDEX "Location_municipality_idx" ON "Location"("municipality");

-- CreateIndex
CREATE INDEX "Location_route_idx" ON "Location"("route");

-- CreateIndex
CREATE INDEX "Municipality_state_idx" ON "Municipality"("state");

-- CreateIndex
CREATE UNIQUE INDEX "State_name_key" ON "State"("name");

-- CreateIndex
CREATE INDEX "DocumentPhoto_documentType_idx" ON "DocumentPhoto"("documentType");

-- CreateIndex
CREATE INDEX "DocumentPhoto_isError_idx" ON "DocumentPhoto"("isError");

-- CreateIndex
CREATE INDEX "DocumentPhoto_isMissing_idx" ON "DocumentPhoto"("isMissing");

-- CreateIndex
CREATE INDEX "DocumentPhoto_personalData_idx" ON "DocumentPhoto"("personalData");

-- CreateIndex
CREATE INDEX "DocumentPhoto_loan_idx" ON "DocumentPhoto"("loan");

-- CreateIndex
CREATE INDEX "DocumentPhoto_uploadedBy_idx" ON "DocumentPhoto"("uploadedBy");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramUser_chatId_key" ON "TelegramUser"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramUser_platformUser_key" ON "TelegramUser"("platformUser");

-- CreateIndex
CREATE INDEX "TelegramUser_platformUser_idx" ON "TelegramUser"("platformUser");

-- CreateIndex
CREATE INDEX "ReportExecutionLog_reportConfig_idx" ON "ReportExecutionLog"("reportConfig");

-- CreateIndex
CREATE INDEX "ReportExecutionLog_status_idx" ON "ReportExecutionLog"("status");

-- CreateIndex
CREATE INDEX "ReportExecutionLog_executionType_idx" ON "ReportExecutionLog"("executionType");

-- CreateIndex
CREATE INDEX "ReportExecutionLog_startTime_idx" ON "ReportExecutionLog"("startTime");

-- CreateIndex
CREATE INDEX "ReportExecutionLog_createdAt_idx" ON "ReportExecutionLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_operation_idx" ON "AuditLog"("operation");

-- CreateIndex
CREATE INDEX "AuditLog_modelName_idx" ON "AuditLog"("modelName");

-- CreateIndex
CREATE INDEX "AuditLog_recordId_idx" ON "AuditLog"("recordId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_user_idx" ON "AuditLog"("user");

-- CreateIndex
CREATE INDEX "PortfolioCleanup_route_idx" ON "PortfolioCleanup"("route");

-- CreateIndex
CREATE INDEX "PortfolioCleanup_executedBy_idx" ON "PortfolioCleanup"("executedBy");

-- CreateIndex
CREATE INDEX "_RouteEmployees_B_index" ON "_RouteEmployees"("B");

-- CreateIndex
CREATE INDEX "_LoanCollaterals_B_index" ON "_LoanCollaterals"("B");

-- CreateIndex
CREATE INDEX "_RouteAccounts_B_index" ON "_RouteAccounts"("B");

-- CreateIndex
CREATE INDEX "_ReportConfigRoutes_B_index" ON "_ReportConfigRoutes"("B");

-- CreateIndex
CREATE INDEX "_ReportConfigRecipients_B_index" ON "_ReportConfigRecipients"("B");

-- AddForeignKey
ALTER TABLE "Phone" ADD CONSTRAINT "Phone_personalData_fkey" FOREIGN KEY ("personalData") REFERENCES "PersonalData"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_personalData_fkey" FOREIGN KEY ("personalData") REFERENCES "PersonalData"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_personalData_fkey" FOREIGN KEY ("personalData") REFERENCES "PersonalData"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_user_fkey" FOREIGN KEY ("user") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrower" ADD CONSTRAINT "Borrower_personalData_fkey" FOREIGN KEY ("personalData") REFERENCES "PersonalData"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_borrower_fkey" FOREIGN KEY ("borrower") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_loantype_fkey" FOREIGN KEY ("loantype") REFERENCES "Loantype"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_grantor_fkey" FOREIGN KEY ("grantor") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_lead_fkey" FOREIGN KEY ("lead") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_snapshotRouteId_fkey" FOREIGN KEY ("snapshotRouteId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_previousLoan_fkey" FOREIGN KEY ("previousLoan") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_excludedByCleanup_fkey" FOREIGN KEY ("excludedByCleanup") REFERENCES "PortfolioCleanup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_loan_fkey" FOREIGN KEY ("loan") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_leadPaymentReceived_fkey" FOREIGN KEY ("leadPaymentReceived") REFERENCES "LeadPaymentReceived"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPaymentReceived" ADD CONSTRAINT "LeadPaymentReceived_lead_fkey" FOREIGN KEY ("lead") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPaymentReceived" ADD CONSTRAINT "LeadPaymentReceived_agent_fkey" FOREIGN KEY ("agent") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FalcoCompensatoryPayment" ADD CONSTRAINT "FalcoCompensatoryPayment_leadPaymentReceived_fkey" FOREIGN KEY ("leadPaymentReceived") REFERENCES "LeadPaymentReceived"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPayment" ADD CONSTRAINT "CommissionPayment_loan_fkey" FOREIGN KEY ("loan") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPayment" ADD CONSTRAINT "CommissionPayment_employee_fkey" FOREIGN KEY ("employee") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_loan_fkey" FOREIGN KEY ("loan") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_loanPayment_fkey" FOREIGN KEY ("loanPayment") REFERENCES "LoanPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_sourceAccount_fkey" FOREIGN KEY ("sourceAccount") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_destinationAccount_fkey" FOREIGN KEY ("destinationAccount") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_route_fkey" FOREIGN KEY ("route") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_lead_fkey" FOREIGN KEY ("lead") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_leadPaymentReceived_fkey" FOREIGN KEY ("leadPaymentReceived") REFERENCES "LeadPaymentReceived"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_municipality_fkey" FOREIGN KEY ("municipality") REFERENCES "Municipality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_route_fkey" FOREIGN KEY ("route") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Municipality" ADD CONSTRAINT "Municipality_state_fkey" FOREIGN KEY ("state") REFERENCES "State"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPhoto" ADD CONSTRAINT "DocumentPhoto_personalData_fkey" FOREIGN KEY ("personalData") REFERENCES "PersonalData"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPhoto" ADD CONSTRAINT "DocumentPhoto_loan_fkey" FOREIGN KEY ("loan") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPhoto" ADD CONSTRAINT "DocumentPhoto_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramUser" ADD CONSTRAINT "TelegramUser_platformUser_fkey" FOREIGN KEY ("platformUser") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportExecutionLog" ADD CONSTRAINT "ReportExecutionLog_reportConfig_fkey" FOREIGN KEY ("reportConfig") REFERENCES "ReportConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_user_fkey" FOREIGN KEY ("user") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioCleanup" ADD CONSTRAINT "PortfolioCleanup_route_fkey" FOREIGN KEY ("route") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioCleanup" ADD CONSTRAINT "PortfolioCleanup_executedBy_fkey" FOREIGN KEY ("executedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RouteEmployees" ADD CONSTRAINT "_RouteEmployees_A_fkey" FOREIGN KEY ("A") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RouteEmployees" ADD CONSTRAINT "_RouteEmployees_B_fkey" FOREIGN KEY ("B") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LoanCollaterals" ADD CONSTRAINT "_LoanCollaterals_A_fkey" FOREIGN KEY ("A") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LoanCollaterals" ADD CONSTRAINT "_LoanCollaterals_B_fkey" FOREIGN KEY ("B") REFERENCES "PersonalData"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RouteAccounts" ADD CONSTRAINT "_RouteAccounts_A_fkey" FOREIGN KEY ("A") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RouteAccounts" ADD CONSTRAINT "_RouteAccounts_B_fkey" FOREIGN KEY ("B") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReportConfigRoutes" ADD CONSTRAINT "_ReportConfigRoutes_A_fkey" FOREIGN KEY ("A") REFERENCES "ReportConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReportConfigRoutes" ADD CONSTRAINT "_ReportConfigRoutes_B_fkey" FOREIGN KEY ("B") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReportConfigRecipients" ADD CONSTRAINT "_ReportConfigRecipients_A_fkey" FOREIGN KEY ("A") REFERENCES "ReportConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReportConfigRecipients" ADD CONSTRAINT "_ReportConfigRecipients_B_fkey" FOREIGN KEY ("B") REFERENCES "TelegramUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
