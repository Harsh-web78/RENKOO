-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('domain', 'url_prefix');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('healthy', 'needs_attention', 'stale', 'disconnected');

-- CreateEnum
CREATE TYPE "GscPermissionLevel" AS ENUM ('siteOwner', 'siteFullUser', 'siteRestrictedUser', 'siteUnverifiedUser');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('connected', 'expired', 'revoked', 'needs_reauth', 'error');

-- CreateEnum
CREATE TYPE "Freshness" AS ENUM ('fresh', 'delayed', 'stale', 'unavailable');

-- CreateEnum
CREATE TYPE "Quality" AS ENUM ('complete', 'partial', 'missing', 'delayed', 'conflicting', 'unavailable');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('recommendation_available', 'no_signal', 'insufficient_data', 'stale_data', 'unavailable');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('ctr_below_expected', 'position_decline', 'content_relevance_gap');

-- CreateEnum
CREATE TYPE "FixApplyStatus" AS ENUM ('available', 'reviewed', 'applied', 'dismissed', 'acknowledged');

-- CreateEnum
CREATE TYPE "OutcomeStatus" AS ENUM ('positive_change', 'no_material_change', 'negative_change', 'insufficient_data', 'data_delayed', 'conflicting_data', 'unavailable');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'solo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("userId","workspaceId")
);

-- CreateTable
CREATE TABLE "SearchConsoleConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleAccountEmail" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "status" "ConnectionStatus" NOT NULL DEFAULT 'connected',
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "lastRefreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchConsoleConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchProperty" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "type" "PropertyType" NOT NULL,
    "permissionLevel" "GscPermissionLevel",
    "status" "PropertyStatus" NOT NULL DEFAULT 'healthy',
    "isSelectable" BOOLEAN NOT NULL DEFAULT true,
    "siteOrigin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchDataSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "dataThrough" TIMESTAMP(3) NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "freshness" "Freshness" NOT NULL,
    "quality" "Quality" NOT NULL,
    "limitations" TEXT[],
    "normalizedJson" JSONB NOT NULL,
    "rawResponseHash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchDataSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "signal" "SignalType" NOT NULL,
    "page" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "finding" TEXT NOT NULL,
    "interpretation" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidenceJson" JSONB NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "limitations" TEXT[],
    "status" "RecommendationStatus" NOT NULL DEFAULT 'recommendation_available',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fix" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "page" TEXT NOT NULL,
    "status" "FixApplyStatus" NOT NULL DEFAULT 'available',
    "dismissReason" TEXT,
    "baselineClicks" INTEGER,
    "baselineCtr" TEXT,
    "baselinePosition" DOUBLE PRECISION,
    "baselineCapturedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "expectedMeasurementDate" TIMESTAMP(3),
    "measurementWindowDays" INTEGER NOT NULL DEFAULT 14,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixOutcome" (
    "id" TEXT NOT NULL,
    "fixId" TEXT NOT NULL,
    "status" "OutcomeStatus" NOT NULL,
    "beforeJson" JSONB NOT NULL,
    "afterJson" JSONB,
    "measuredAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");

-- CreateIndex
CREATE INDEX "SearchConsoleConnection_userId_idx" ON "SearchConsoleConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchConsoleConnection_workspaceId_key" ON "SearchConsoleConnection"("workspaceId");

-- CreateIndex
CREATE INDEX "SearchProperty_workspaceId_idx" ON "SearchProperty"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchProperty_workspaceId_siteUrl_key" ON "SearchProperty"("workspaceId", "siteUrl");

-- CreateIndex
CREATE INDEX "SearchDataSnapshot_workspaceId_propertyId_periodEnd_idx" ON "SearchDataSnapshot"("workspaceId", "propertyId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "SearchDataSnapshot_propertyId_periodStart_periodEnd_rawResp_key" ON "SearchDataSnapshot"("propertyId", "periodStart", "periodEnd", "rawResponseHash");

-- CreateIndex
CREATE INDEX "Recommendation_workspaceId_propertyId_createdAt_idx" ON "Recommendation"("workspaceId", "propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "Fix_workspaceId_propertyId_status_idx" ON "Fix"("workspaceId", "propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FixOutcome_fixId_key" ON "FixOutcome"("fixId");

-- CreateIndex
CREATE INDEX "IngestionJob_workspaceId_propertyId_status_idx" ON "IngestionJob"("workspaceId", "propertyId", "status");

-- CreateIndex
CREATE INDEX "IngestionJob_status_createdAt_idx" ON "IngestionJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchConsoleConnection" ADD CONSTRAINT "SearchConsoleConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchConsoleConnection" ADD CONSTRAINT "SearchConsoleConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchProperty" ADD CONSTRAINT "SearchProperty_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchDataSnapshot" ADD CONSTRAINT "SearchDataSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchDataSnapshot" ADD CONSTRAINT "SearchDataSnapshot_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SearchProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SearchProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fix" ADD CONSTRAINT "Fix_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fix" ADD CONSTRAINT "Fix_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SearchProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixOutcome" ADD CONSTRAINT "FixOutcome_fixId_fkey" FOREIGN KEY ("fixId") REFERENCES "Fix"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
