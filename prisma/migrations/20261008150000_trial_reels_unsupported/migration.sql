-- When Meta refused a trial Reel for the account (subcode 2207081), so the
-- composer can disable the option. Nullable: nothing to backfill.

-- AlterTable
ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "trialReelsUnsupportedAt" TIMESTAMP(3);

-- Accounts that already had a trial Reel refused carry it in a failed post.
UPDATE "InstagramAccount" AS account
SET "trialReelsUnsupportedAt" = refused."at"
FROM (
  SELECT "instagramAccountId", MIN("updatedAt") AS "at"
  FROM "ScheduledPost"
  WHERE "status" = 'FAILED' AND "lastError" LIKE '%2207081%'
  GROUP BY "instagramAccountId"
) AS refused
WHERE account."id" = refused."instagramAccountId"
  AND account."trialReelsUnsupportedAt" IS NULL;
