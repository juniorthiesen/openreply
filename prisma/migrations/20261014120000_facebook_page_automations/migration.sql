-- Comment-to-message rules for Facebook Pages, kept apart from Instagram
-- campaigns. New tables and one nullable column, so existing rows need no
-- backfill.

-- AlterTable
ALTER TABLE "FacebookPage" ADD COLUMN     "webhookError" TEXT;

-- CreateTable
CREATE TABLE "FacebookAutomation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "facebookPageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "videoId" TEXT,
    "videoTitle" TEXT,
    "videoUrl" TEXT,
    "matchAnyPost" BOOLEAN NOT NULL DEFAULT false,
    "keywords" TEXT[],
    "matchAnyWord" BOOLEAN NOT NULL DEFAULT false,
    "wholeWordMatch" BOOLEAN NOT NULL DEFAULT true,
    "dmMessage" TEXT NOT NULL,
    "linkUrl" TEXT,
    "linkButtonLabel" TEXT,
    "publicReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publicReplyMessages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacebookAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacebookCommentLog" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "postId" TEXT,
    "commenterId" TEXT NOT NULL,
    "commenterName" TEXT,
    "commentText" TEXT,
    "matchedKeyword" TEXT,
    "status" "DmStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "dmSentAt" TIMESTAMP(3),
    "publicReplySentAt" TIMESTAMP(3),
    "publicReplyError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacebookCommentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FacebookAutomation_workspaceId_idx" ON "FacebookAutomation"("workspaceId");

-- CreateIndex
CREATE INDEX "FacebookAutomation_facebookPageId_isActive_idx" ON "FacebookAutomation"("facebookPageId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FacebookCommentLog_automationId_commentId_key" ON "FacebookCommentLog"("automationId", "commentId");

-- CreateIndex
CREATE INDEX "FacebookCommentLog_automationId_createdAt_idx" ON "FacebookCommentLog"("automationId", "createdAt");

-- AddForeignKey
ALTER TABLE "FacebookAutomation" ADD CONSTRAINT "FacebookAutomation_facebookPageId_fkey" FOREIGN KEY ("facebookPageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacebookCommentLog" ADD CONSTRAINT "FacebookCommentLog_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "FacebookAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
