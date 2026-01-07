-- Remove snapshotRouteId from Loan, Transaction, and AccountEntry
-- This data is now handled by LocationRouteHistory table

-- Drop index first
DROP INDEX IF EXISTS "AccountEntry_snapshotRouteId_entryDate_idx";

-- Remove columns from Loan
ALTER TABLE "Loan" DROP COLUMN IF EXISTS "snapshotRouteId";
ALTER TABLE "Loan" DROP COLUMN IF EXISTS "snapshotRouteName";

-- Remove column from Transaction
ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "snapshotRouteId";

-- Remove column from AccountEntry
ALTER TABLE "AccountEntry" DROP COLUMN IF EXISTS "snapshotRouteId";
