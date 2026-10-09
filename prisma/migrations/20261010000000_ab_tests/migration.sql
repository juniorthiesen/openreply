-- A/B tests of a campaign's link DM. A test has two variants (A is the campaign
-- as it was, B is the change), each with its own tracked link, and the DM log
-- records which variant each person was sent. New table and nullable columns,
-- so existing rows need no backfill.

-- CreateEnum
CREATE TYPE "AbTestStatus" AS ENUM ('RUNNING', 'ENDED');

-- AlterTable
ALTER TABLE "DmLog" ADD COLUMN     "abTestId" TEXT,
ADD COLUMN     "abVariantKey" TEXT;

-- CreateTable
CREATE TABLE "AbTest" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "status" "AbTestStatus" NOT NULL DEFAULT 'RUNNING',
    "weightA" INTEGER NOT NULL DEFAULT 50,
    "winnerKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "aDmMessage" TEXT NOT NULL,
    "aLinkButtonLabel" TEXT,
    "aDestinationUrl" TEXT,
    "aTrackedLinkId" TEXT,
    "bDmMessage" TEXT NOT NULL,
    "bLinkButtonLabel" TEXT,
    "bDestinationUrl" TEXT,
    "bTrackedLinkId" TEXT,

    CONSTRAINT "AbTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AbTest_aTrackedLinkId_key" ON "AbTest"("aTrackedLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "AbTest_bTrackedLinkId_key" ON "AbTest"("bTrackedLinkId");

-- CreateIndex
CREATE INDEX "AbTest_automationId_status_idx" ON "AbTest"("automationId", "status");

-- CreateIndex
CREATE INDEX "DmLog_abTestId_abVariantKey_idx" ON "DmLog"("abTestId", "abVariantKey");

-- AddForeignKey
ALTER TABLE "AbTest" ADD CONSTRAINT "AbTest_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbTest" ADD CONSTRAINT "AbTest_aTrackedLinkId_fkey" FOREIGN KEY ("aTrackedLinkId") REFERENCES "TrackedLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbTest" ADD CONSTRAINT "AbTest_bTrackedLinkId_fkey" FOREIGN KEY ("bTrackedLinkId") REFERENCES "TrackedLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmLog" ADD CONSTRAINT "DmLog_abTestId_fkey" FOREIGN KEY ("abTestId") REFERENCES "AbTest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
