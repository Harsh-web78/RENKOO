-- Prompt 2 (RENKOO Remember layer): superseded Fix status.
-- Purely additive: one new enum value on FixApplyStatus. Existing rows keep
-- their values (cast through text); no drops, no renames of data, no table
-- changes. Written in Prisma's transactional-safe enum-rebuild form because
-- plain `ALTER TYPE ... ADD VALUE` cannot run inside a migration transaction.

-- CreateEnum
CREATE TYPE "FixApplyStatus_new" AS ENUM ('available', 'reviewed', 'applied', 'dismissed', 'acknowledged', 'superseded');

-- AlterTable
ALTER TABLE "Fix" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Fix" ALTER COLUMN "status" TYPE "FixApplyStatus_new" USING "status"::text::"FixApplyStatus_new";
ALTER TABLE "Fix" ALTER COLUMN "status" SET DEFAULT 'available';

-- DropEnum
ALTER TYPE "FixApplyStatus" RENAME TO "FixApplyStatus_old";
ALTER TYPE "FixApplyStatus_new" RENAME TO "FixApplyStatus";
DROP TYPE "FixApplyStatus_old";
