-- Models to try, in order, when the main AI model fails (comma-separated).
-- Nullable column, so existing rows need no backfill.

-- AlterTable
ALTER TABLE "AiConnection" ADD COLUMN "fallbackModels" TEXT;
