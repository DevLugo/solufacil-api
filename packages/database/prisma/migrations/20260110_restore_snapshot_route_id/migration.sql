-- Restore snapshotRouteId to Transaction and AccountEntry
-- This column was removed in 20260105_remove_snapshot_route_id but is needed for route-based filtering

-- Add snapshotRouteId to Transaction (if it doesn't exist)
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "snapshotRouteId" TEXT NOT NULL DEFAULT '';

-- Add snapshotRouteId to AccountEntry (if it doesn't exist)
ALTER TABLE "AccountEntry" ADD COLUMN IF NOT EXISTS "snapshotRouteId" TEXT NOT NULL DEFAULT '';

-- Create indexes for efficient filtering (only if columns exist)
CREATE INDEX IF NOT EXISTS "Transaction_snapshotRouteId_idx" ON "Transaction"("snapshotRouteId");
CREATE INDEX IF NOT EXISTS "AccountEntry_snapshotRouteId_idx" ON "AccountEntry"("snapshotRouteId");
