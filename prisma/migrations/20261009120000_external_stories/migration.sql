-- Stories posted outside Fisga (straight from the Instagram app), captured while
-- they are still live, plus their metric snapshots. Only new tables, so existing
-- rows need no backfill.

-- CreateTable
CREATE TABLE "ExternalStory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "instagramMediaId" TEXT NOT NULL,
    "mediaType" TEXT,
    "caption" TEXT,
    "permalink" TEXT,
    "mediaUrl" TEXT,
    "mediaStorageKey" TEXT,
    "mediaContentType" TEXT,
    "mediaByteSize" INTEGER,
    "mediaStoredAt" TIMESTAMP(3),
    "mediaPurgedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalStory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalStoryMetricSnapshot" (
    "id" TEXT NOT NULL,
    "externalStoryId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reach" INTEGER,
    "views" INTEGER,
    "replies" INTEGER,
    "shares" INTEGER,
    "follows" INTEGER,
    "profileVisits" INTEGER,
    "totalInteractions" INTEGER,
    "navigation" JSONB,

    CONSTRAINT "ExternalStoryMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalStory_instagramMediaId_key" ON "ExternalStory"("instagramMediaId");

-- CreateIndex
CREATE INDEX "ExternalStory_workspaceId_postedAt_idx" ON "ExternalStory"("workspaceId", "postedAt");

-- CreateIndex
CREATE INDEX "ExternalStory_instagramAccountId_postedAt_idx" ON "ExternalStory"("instagramAccountId", "postedAt");

-- CreateIndex
CREATE INDEX "ExternalStoryMetricSnapshot_externalStoryId_capturedAt_idx" ON "ExternalStoryMetricSnapshot"("externalStoryId", "capturedAt");

-- AddForeignKey
ALTER TABLE "ExternalStory" ADD CONSTRAINT "ExternalStory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalStory" ADD CONSTRAINT "ExternalStory_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalStoryMetricSnapshot" ADD CONSTRAINT "ExternalStoryMetricSnapshot_externalStoryId_fkey" FOREIGN KEY ("externalStoryId") REFERENCES "ExternalStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
