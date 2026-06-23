-- 053_review_reply_drafts.sql
-- Backoffice approval gate for NEGATIVE (1-3 star) Google reviews.
--
-- AI drafts a reply, a human approves/rejects it in backoffice, and only then
-- is it posted to GBP. Positive (4-5 star) reviews never enter this table —
-- they auto-post via /api/cron/reviews-auto-reply.
--
-- Column names are camelCase + quoted to match the Prisma model
-- (ReviewReplyDraft) — Prisma maps field names to column names verbatim.

CREATE TABLE IF NOT EXISTS "ReviewReplyDraft" (
  "id"           text PRIMARY KEY,
  "reviewId"     text NOT NULL UNIQUE,                         -- GBP review id
  "outletId"     text NOT NULL REFERENCES "Outlet"("id"),
  "reviewerName" text,
  "rating"       integer NOT NULL,
  "comment"      text,
  "draftReply"   text NOT NULL,                                -- AI-generated draft
  "finalReply"   text,                                         -- actually-posted text (if edited)
  "status"       text NOT NULL DEFAULT 'pending',              -- pending | approved | rejected | resolved
  "decidedBy"    text,
  "decidedAt"    timestamptz,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ReviewReplyDraft_status_idx"   ON "ReviewReplyDraft" ("status");
CREATE INDEX IF NOT EXISTS "ReviewReplyDraft_outletId_idx" ON "ReviewReplyDraft" ("outletId");
