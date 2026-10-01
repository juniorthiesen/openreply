CREATE TYPE "MediaAssetStatus" AS ENUM ('UPLOADING', 'READY');

CREATE TYPE "ScheduledPostMediaType" AS ENUM ('IMAGE', 'REEL');

CREATE TYPE "ScheduledPostStatus" AS ENUM (
  'DRAFT',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'CANCELED'
);

ALTER TABLE "InstagramAccount"
ADD COLUMN "publishingPermissionGranted" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "storageKey" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "uploadedBytes" INTEGER NOT NULL DEFAULT 0,
  "status" "MediaAssetStatus" NOT NULL DEFAULT 'UPLOADING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduledPost" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "automationId" TEXT,
  "mediaType" "ScheduledPostMediaType" NOT NULL,
  "status" "ScheduledPostStatus" NOT NULL DEFAULT 'DRAFT',
  "caption" TEXT NOT NULL DEFAULT '',
  "scheduledAt" TIMESTAMP(3),
  "timeZone" TEXT NOT NULL DEFAULT 'UTC',
  "shareToFeed" BOOLEAN NOT NULL DEFAULT true,
  "containerId" TEXT,
  "instagramMediaId" TEXT,
  "permalink" TEXT,
  "publishedAt" TIMESTAMP(3),
  "publishStartedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");
CREATE INDEX "MediaAsset_workspaceId_instagramAccountId_createdAt_idx"
  ON "MediaAsset"("workspaceId", "instagramAccountId", "createdAt");
CREATE INDEX "MediaAsset_status_createdAt_idx"
  ON "MediaAsset"("status", "createdAt");

CREATE UNIQUE INDEX "ScheduledPost_automationId_key" ON "ScheduledPost"("automationId");
CREATE INDEX "ScheduledPost_workspaceId_instagramAccountId_scheduledAt_idx"
  ON "ScheduledPost"("workspaceId", "instagramAccountId", "scheduledAt");
CREATE INDEX "ScheduledPost_instagramAccountId_status_scheduledAt_idx"
  ON "ScheduledPost"("instagramAccountId", "status", "scheduledAt");
CREATE INDEX "ScheduledPost_mediaAssetId_idx" ON "ScheduledPost"("mediaAssetId");

ALTER TABLE "MediaAsset"
ADD CONSTRAINT "MediaAsset_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaAsset"
ADD CONSTRAINT "MediaAsset_instagramAccountId_fkey"
FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledPost"
ADD CONSTRAINT "ScheduledPost_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledPost"
ADD CONSTRAINT "ScheduledPost_instagramAccountId_fkey"
FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledPost"
ADD CONSTRAINT "ScheduledPost_mediaAssetId_fkey"
FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduledPost"
ADD CONSTRAINT "ScheduledPost_automationId_fkey"
FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
