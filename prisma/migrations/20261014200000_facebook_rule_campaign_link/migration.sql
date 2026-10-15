-- Links a Facebook rule to the Instagram campaign it belongs to, so one campaign
-- can run on both channels. Nullable: existing rules keep working on their own.

-- AlterTable
ALTER TABLE "FacebookAutomation" ADD COLUMN     "automationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FacebookAutomation_automationId_key" ON "FacebookAutomation"("automationId");

-- AddForeignKey
ALTER TABLE "FacebookAutomation" ADD CONSTRAINT "FacebookAutomation_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
