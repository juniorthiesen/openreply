-- Keyword reply rules created from a Stories sequence, and which Story a DM
-- replied to. Both columns are nullable, so existing rows need no backfill.

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "storySequenceId" TEXT;

-- AlterTable
ALTER TABLE "DmLog" ADD COLUMN IF NOT EXISTS "storyMediaId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Automation_storySequenceId_idx" ON "Automation"("storySequenceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DmLog_storyMediaId_idx" ON "DmLog"("storyMediaId");

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_storySequenceId_fkey" FOREIGN KEY ("storySequenceId") REFERENCES "StorySequence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
