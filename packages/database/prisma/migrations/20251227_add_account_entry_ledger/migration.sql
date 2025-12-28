-- CreateEnum
CREATE TYPE "AccountEntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('LOAN_GRANT', 'LOAN_GRANT_COMMISSION', 'LOAN_CANCELLED_RESTORE', 'LOAN_PAYMENT_CASH', 'LOAN_PAYMENT_BANK', 'PAYMENT_COMMISSION', 'TRANSFER_OUT', 'TRANSFER_IN', 'GASOLINE', 'GASOLINE_TOKA', 'NOMINA_SALARY', 'EXTERNAL_SALARY', 'VIATIC', 'TRAVEL_EXPENSES', 'FALCO_LOSS', 'FALCO_COMPENSATORY', 'INITIAL_BALANCE', 'BALANCE_ADJUSTMENT');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "lastReconciledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AccountEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "entryType" "AccountEntryType" NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "profitAmount" DECIMAL(10,2) DEFAULT 0,
    "returnToCapital" DECIMAL(10,2) DEFAULT 0,
    "snapshotLeadId" TEXT NOT NULL DEFAULT '',
    "snapshotRouteId" TEXT NOT NULL DEFAULT '',
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL DEFAULT '',
    "loanId" TEXT,
    "loanPaymentId" TEXT,
    "leadPaymentReceivedId" TEXT,
    "destinationAccountId" TEXT,
    "syncId" TEXT NOT NULL,

    CONSTRAINT "AccountEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountEntry_accountId_idx" ON "AccountEntry"("accountId");

-- CreateIndex
CREATE INDEX "AccountEntry_entryDate_idx" ON "AccountEntry"("entryDate");

-- CreateIndex
CREATE INDEX "AccountEntry_sourceType_idx" ON "AccountEntry"("sourceType");

-- CreateIndex
CREATE INDEX "AccountEntry_snapshotRouteId_entryDate_idx" ON "AccountEntry"("snapshotRouteId", "entryDate");

-- CreateIndex
CREATE INDEX "AccountEntry_syncId_idx" ON "AccountEntry"("syncId");

-- CreateIndex
CREATE INDEX "AccountEntry_loanId_idx" ON "AccountEntry"("loanId");

-- CreateIndex
CREATE INDEX "AccountEntry_loanPaymentId_idx" ON "AccountEntry"("loanPaymentId");

-- CreateIndex
CREATE INDEX "AccountEntry_leadPaymentReceivedId_idx" ON "AccountEntry"("leadPaymentReceivedId");

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_loanPaymentId_fkey" FOREIGN KEY ("loanPaymentId") REFERENCES "LoanPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_leadPaymentReceivedId_fkey" FOREIGN KEY ("leadPaymentReceivedId") REFERENCES "LeadPaymentReceived"("id") ON DELETE SET NULL ON UPDATE CASCADE;
