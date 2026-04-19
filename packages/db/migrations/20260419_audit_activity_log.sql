-- Extend ActivityLog for audit-log use cases.
-- Apply via Supabase MCP (db push is disabled; see packages/db/package.json).
-- All statements are idempotent.
--
-- Names match Prisma's default naming convention so a future
-- `prisma migrate diff` will not try to re-create them.

-- System/webhook-initiated actions have no human actor — allow null.
ALTER TABLE "ActivityLog" ALTER COLUMN "userId" DROP NOT NULL;

-- Structured before/after snapshots + free-form context (e.g. source: "telegram").
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "diff" JSONB;
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Lookup: "who touched entity X, and when?"
CREATE INDEX IF NOT EXISTS "ActivityLog_targetId_createdAt_idx"
  ON "ActivityLog"("targetId", "createdAt" DESC);
