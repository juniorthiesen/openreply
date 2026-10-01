-- CreateEnum
CREATE TYPE "InstagramAuthProvider" AS ENUM ('INSTAGRAM_LOGIN', 'FACEBOOK_LOGIN');

-- AlterTable
ALTER TABLE "InstagramAccount"
  ADD COLUMN "authProvider" "InstagramAuthProvider" NOT NULL DEFAULT 'INSTAGRAM_LOGIN',
  ADD COLUMN "facebookPageId" TEXT;

-- CreateTable
CREATE TABLE "FacebookPage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "facebookPageId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "username" TEXT,
  "accessToken" TEXT NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3),
  "webhookSubscribed" BOOLEAN NOT NULL DEFAULT false,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacebookPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacebookOAuthConnection" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "pages" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FacebookOAuthConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FacebookPage_facebookPageId_key" ON "FacebookPage"("facebookPageId");
CREATE INDEX "FacebookPage_workspaceId_idx" ON "FacebookPage"("workspaceId");
CREATE INDEX "FacebookOAuthConnection_workspaceId_idx" ON "FacebookOAuthConnection"("workspaceId");
CREATE INDEX "FacebookOAuthConnection_expiresAt_idx" ON "FacebookOAuthConnection"("expiresAt");

-- AddForeignKey
ALTER TABLE "FacebookPage" ADD CONSTRAINT "FacebookPage_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FacebookOAuthConnection" ADD CONSTRAINT "FacebookOAuthConnection_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
