-- A workspace's own AI endpoint, set from Settings. The key is stored encrypted.
-- New table, so existing rows need no backfill.

-- CreateTable
CREATE TABLE "AiConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiConnection_workspaceId_key" ON "AiConnection"("workspaceId");

-- AddForeignKey
ALTER TABLE "AiConnection" ADD CONSTRAINT "AiConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
