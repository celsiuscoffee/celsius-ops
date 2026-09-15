-- NOT YET APPLIED. Apply via Supabase MCP (apply_migration: owner_todo_capture)
-- only on the owner's explicit approval in session (hard rule 6), then update
-- this header with the date.
-- Audit-trail twin: packages/db/prisma/migrations/20260916_owner_todo_capture/migration.sql
--
-- Owner to-do kanban (docs/design/owner-todo-kanban.md): provenance + board
-- position + owner verdict on OpsReminder, and the two agent registry rows.

ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "sourceRef" TEXT;
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "sourceChat" TEXT;
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "sourceExcerpt" TEXT;
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "stage" TEXT NOT NULL DEFAULT 'todo';
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "triageDecision" TEXT;
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "proposedByAgent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION;
UPDATE "OpsReminder" SET "stage" = 'done' WHERE "status" = 'DONE' AND "stage" = 'todo';
CREATE UNIQUE INDEX IF NOT EXISTS "OpsReminder_source_sourceRef_key" ON "OpsReminder" ("source", "sourceRef");
CREATE INDEX IF NOT EXISTS "OpsReminder_stage_status_idx" ON "OpsReminder" ("stage", "status");

-- Agent registry: capture starts SHADOW (proposes into Triage, owner accepts or
-- rejects); the nudge starts ARMED (owner-only Telegram digest, low risk).
-- Arming criteria for capture: accepted / proposed >= 70% over 14 days,
-- reviewed 2026-09-30. Mode in the registry is the only switch.
insert into agent_registry
  (key, name, domain, description, mode, kind, trigger_detail, uses_llm, model, kill_switch_note, code_path, arming_criteria)
values
  ('owner_todo_capture', 'Owner to-do capture', 'owner',
   'Reads the owner''s own WhatsApp Desktop messages (local SQLite on the owner''s Mac, shipped hourly by a launchd scanner) and proposes to-do cards: open asks addressed to the owner and promises the owner made. Shadow = proposals land in the Triage column for accept/reject. Armed = confident proposals land in To Do directly.',
   'shadow', 'scheduled_task', 'hourly while the owner''s Mac is awake (launchd com.celsius.owner-todo-scanner) + 23:30 catch-up', true, 'claude-sonnet-4-6',
   'Registry mode is the only switch (fail-safe off via getAgentMode). off = the ingest endpoint accepts and discards.',
   'apps/backoffice/src/lib/owner-todo/capture.ts',
   'Accepted / proposed >= 70% over 14 days of Triage verdicts (triageDecision), reviewed 2026-09-30.'),
  ('owner_todo_nudge', 'Owner to-do nudge', 'owner',
   'Daily Telegram digest of the owner''s board: Triage proposals with Accept/Reject buttons, overdue cards, and the top To Do items with a Done button. Folded into the 9am morning-briefing firing; no new cron.',
   'armed', 'scheduled_task', 'daily 9am MYT with the intelligence briefing', false, null,
   'Registry mode is the only switch (getAgentModeOrDefault armed).',
   'apps/backoffice/src/lib/owner-todo/digest.ts',
   'Armed from day one: owner-only channel, buttons only mutate the owner''s own cards.')
on conflict (key) do nothing;
