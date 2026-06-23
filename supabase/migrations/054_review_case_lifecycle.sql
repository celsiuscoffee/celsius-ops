-- 054_review_case_lifecycle.sql
-- Grow ReviewReplyDraft from a reply-draft into a full negative-review CASE
-- record, tracked through to compensation/resolution.
--
-- status lifecycle (text, no DB constraint — kept flexible):
--   pending     → NEW, AI-drafted, awaiting manager
--   approved    → reply posted + recovery code live, AWAITING CUSTOMER
--   compensated → customer claimed the code, captured into loyalty + voucher issued
--   resolved    → made whole (voucher redeemed, or manager closed)
--   rejected    → manager declined (fake / no action)
--   expired     → recovery code never claimed
--
-- Recovery: the approved public reply carries a single-use "recoveryCode".
-- The customer enters it on the public recovery form, which captures their
-- phone into loyalty and issues a voucher tagged to this review (misuse gate).

ALTER TABLE "ReviewReplyDraft"
  ADD COLUMN IF NOT EXISTS "recoveryCode"     text,
  ADD COLUMN IF NOT EXISTS "recoveryCodeAt"   timestamptz,
  ADD COLUMN IF NOT EXISTS "claimedAt"        timestamptz,
  ADD COLUMN IF NOT EXISTS "recoveryMemberId" text,
  ADD COLUMN IF NOT EXISTS "recoveryRewardId" text,
  ADD COLUMN IF NOT EXISTS "redeemedAt"       timestamptz,
  ADD COLUMN IF NOT EXISTS "resolvedAt"       timestamptz,
  ADD COLUMN IF NOT EXISTS "resolvedBy"       text,
  ADD COLUMN IF NOT EXISTS "resolutionNote"   text;

-- Single-use codes. NULLs are distinct in Postgres, so un-coded rows are fine.
CREATE UNIQUE INDEX IF NOT EXISTS "ReviewReplyDraft_recoveryCode_key"
  ON "ReviewReplyDraft" ("recoveryCode");
