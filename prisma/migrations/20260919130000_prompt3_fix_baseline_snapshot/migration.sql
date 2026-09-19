-- Prompt 3 (RENKOO Measure layer): pin the exact baseline snapshot per Fix.
-- Purely additive: one nullable column, no default, no backfill (pre-Prompt-3
-- rows keep NULL = legacy, handled in code). No drops, no renames, no enum
-- changes, no new tables, no index changes.

-- AlterTable
ALTER TABLE "Fix" ADD COLUMN "baselineSnapshotId" TEXT;
