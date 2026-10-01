CREATE TYPE "TrialReelGraduationStrategy" AS ENUM ('MANUAL', 'SS_PERFORMANCE');

ALTER TABLE "ScheduledPost"
ADD COLUMN "trialGraduationStrategy" "TrialReelGraduationStrategy";

CREATE INDEX "ScheduledPost_instagramAccountId_status_trialGraduationStrategy_publishedAt_idx"
ON "ScheduledPost"("instagramAccountId", "status", "trialGraduationStrategy", "publishedAt");
