-- Prompt 1 (RENKOO backend hardening): additive Fix memory fields + indexes.
-- Purely additive: three nullable columns (existing rows read as NULL) and
-- three new indexes. No drops, no renames, no enum changes, no new tables.

-- AlterTable
ALTER TABLE "Fix" ADD COLUMN "dismissedAt" TIMESTAMP(3);
ALTER TABLE "Fix" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);
ALTER TABLE "Fix" ADD COLUMN "signalFingerprint" TEXT;

-- CreateIndex
CREATE INDEX "Fix_workspaceId_propertyId_status_createdAt_idx" ON "Fix"("workspaceId", "propertyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Fix_propertyId_status_idx" ON "Fix"("propertyId", "status");

-- CreateIndex
CREATE INDEX "Fix_workspaceId_createdAt_idx" ON "Fix"("workspaceId", "createdAt");
