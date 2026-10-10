ALTER TABLE "Automation" ADD COLUMN "storyMediaId" TEXT;

CREATE INDEX "Automation_storyMediaId_idx" ON "Automation"("storyMediaId");
