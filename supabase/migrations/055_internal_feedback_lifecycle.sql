-- 055_internal_feedback_lifecycle.sql
-- Bring internal QR feedback (1-3★) into the same negative-feedback case manager
-- as Google reviews. QR feedback already carries the customer's phone, so it
-- skips the recovery-code step — a manager can compensate directly.
--
-- status lifecycle: open → compensated → resolved, or dismissed.

ALTER TABLE "InternalFeedback"
  ADD COLUMN IF NOT EXISTS "status"           text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS "recoveryMemberId" text,
  ADD COLUMN IF NOT EXISTS "recoveryRewardId" text,
  ADD COLUMN IF NOT EXISTS "compensatedAt"    timestamptz,
  ADD COLUMN IF NOT EXISTS "resolvedAt"       timestamptz,
  ADD COLUMN IF NOT EXISTS "resolvedBy"       text,
  ADD COLUMN IF NOT EXISTS "resolutionNote"   text;

CREATE INDEX IF NOT EXISTS "InternalFeedback_status_idx" ON "InternalFeedback" ("status");
