-- Owner to-do kanban: capture columns on OpsReminder.
-- Design: docs/design/owner-todo-kanban.md (office-hours 2026-09-16).
--
-- WHY. OpsReminder already models a single-owner to-do with due dates, snooze
-- and an hourly due-nudge cron, but nothing feeds it for the owner. This adds
-- (a) provenance so an agent can propose cards from the owner's own WhatsApp
-- messages without ever proposing the same message twice (unique on
-- source+sourceRef), (b) a board position (stage) so the same rows render as
-- a kanban, and (c) the owner's accept/reject verdict (triageDecision), which
-- is the outcome the capture agent's precision is measured on.
--
-- All additive. Existing rows read as source='manual', stage='todo'.
-- Twin: supabase/migrations/111_owner_todo_capture.sql (the applied trail).

ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "sourceRef" TEXT;
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "sourceChat" TEXT;
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "sourceExcerpt" TEXT;
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "stage" TEXT NOT NULL DEFAULT 'todo';
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "triageDecision" TEXT;
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "proposedByAgent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION;

-- Rows already DONE sit in the done column; everything else starts in todo.
UPDATE "OpsReminder" SET "stage" = 'done' WHERE "status" = 'DONE' AND "stage" = 'todo';

CREATE UNIQUE INDEX IF NOT EXISTS "OpsReminder_source_sourceRef_key" ON "OpsReminder" ("source", "sourceRef");
CREATE INDEX IF NOT EXISTS "OpsReminder_stage_status_idx" ON "OpsReminder" ("stage", "status");
