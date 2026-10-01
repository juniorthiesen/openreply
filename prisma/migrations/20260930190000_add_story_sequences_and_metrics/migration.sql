CREATE TYPE "StorySequenceStatus" AS ENUM (
  'DRAFT',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'PARTIAL',
  'FAILED',
  'CANCELED'
);

CREATE TYPE "StorySlideStatus" AS ENUM (
  'PENDING',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED'
);

CREATE TABLE "StorySequence" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'Nova sequência',
  "status" "StorySequenceStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduledAt" TIMESTAMP(3),
  "timeZone" TEXT NOT NULL DEFAULT 'UTC',
  "publishedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorySequence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StorySlide" (
  "id" TEXT NOT NULL,
  "sequenceId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "status" "StorySlideStatus" NOT NULL DEFAULT 'PENDING',
  "containerId" TEXT,
  "instagramMediaId" TEXT,
  "publishStartedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorySlide_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoryMetricSnapshot" (
  "id" TEXT NOT NULL,
  "storySlideId" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reach" INTEGER,
  "views" INTEGER,
  "replies" INTEGER,
  "shares" INTEGER,
  "follows" INTEGER,
  "profileVisits" INTEGER,
  "totalInteractions" INTEGER,
  "navigation" JSONB,
  CONSTRAINT "StoryMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorySlide_instagramMediaId_key" ON "StorySlide"("instagramMediaId");
CREATE UNIQUE INDEX "StorySlide_sequenceId_position_key" ON "StorySlide"("sequenceId", "position");
CREATE UNIQUE INDEX "StorySlide_sequenceId_mediaAssetId_key" ON "StorySlide"("sequenceId", "mediaAssetId");
CREATE INDEX "StorySequence_workspaceId_instagramAccountId_scheduledAt_idx" ON "StorySequence"("workspaceId", "instagramAccountId", "scheduledAt");
CREATE INDEX "StorySequence_instagramAccountId_status_scheduledAt_idx" ON "StorySequence"("instagramAccountId", "status", "scheduledAt");
CREATE INDEX "StorySlide_mediaAssetId_idx" ON "StorySlide"("mediaAssetId");
CREATE INDEX "StorySlide_sequenceId_status_idx" ON "StorySlide"("sequenceId", "status");
CREATE INDEX "StorySlide_publishedAt_idx" ON "StorySlide"("publishedAt");
CREATE INDEX "StoryMetricSnapshot_storySlideId_capturedAt_idx" ON "StoryMetricSnapshot"("storySlideId", "capturedAt");

ALTER TABLE "StorySequence" ADD CONSTRAINT "StorySequence_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorySequence" ADD CONSTRAINT "StorySequence_instagramAccountId_fkey"
  FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorySlide" ADD CONSTRAINT "StorySlide_sequenceId_fkey"
  FOREIGN KEY ("sequenceId") REFERENCES "StorySequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorySlide" ADD CONSTRAINT "StorySlide_mediaAssetId_fkey"
  FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoryMetricSnapshot" ADD CONSTRAINT "StoryMetricSnapshot_storySlideId_fkey"
  FOREIGN KEY ("storySlideId") REFERENCES "StorySlide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
