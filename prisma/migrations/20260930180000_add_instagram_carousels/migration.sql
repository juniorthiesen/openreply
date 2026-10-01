ALTER TYPE "ScheduledPostMediaType" ADD VALUE 'CAROUSEL';

CREATE TABLE "ScheduledPostMediaItem" (
  "id" TEXT NOT NULL,
  "scheduledPostId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "containerId" TEXT,
  CONSTRAINT "ScheduledPostMediaItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduledPostMediaItem_scheduledPostId_position_key"
  ON "ScheduledPostMediaItem"("scheduledPostId", "position");
CREATE UNIQUE INDEX "ScheduledPostMediaItem_scheduledPostId_mediaAssetId_key"
  ON "ScheduledPostMediaItem"("scheduledPostId", "mediaAssetId");
CREATE INDEX "ScheduledPostMediaItem_mediaAssetId_idx"
  ON "ScheduledPostMediaItem"("mediaAssetId");

ALTER TABLE "ScheduledPostMediaItem"
ADD CONSTRAINT "ScheduledPostMediaItem_scheduledPostId_fkey"
FOREIGN KEY ("scheduledPostId") REFERENCES "ScheduledPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledPostMediaItem"
ADD CONSTRAINT "ScheduledPostMediaItem_mediaAssetId_fkey"
FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
