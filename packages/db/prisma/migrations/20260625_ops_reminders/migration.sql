-- Ad-hoc reminders for the Ops Workspace (manager-authored follow-ups / staff
-- to-dos). Apply to the LIVE backoffice DB — the project Prisma's DATABASE_URL
-- points to, which holds User / OpsAlert / WhatsAppMessage ("celsiuscoffee's
-- Project", ref kqdcdhpnyuwrxqhbuyfl). Matches model OpsReminder in
-- packages/db/prisma/schema.prisma.
--
-- RLS is enabled because reminders can name staff + carry operational notes; the
-- app reaches it only via Prisma (privileged connection, bypasses RLS), so no
-- policies are needed — same posture as the other Prisma-owned tables.

CREATE TABLE IF NOT EXISTS "OpsReminder" (
  "id"              text PRIMARY KEY,
  "title"           text NOT NULL,
  "notes"           text,
  "createdByUserId" text NOT NULL,
  "assigneeUserId"  text,
  "dueAt"           timestamptz,
  "status"          text NOT NULL DEFAULT 'OPEN',
  "snoozedUntil"    timestamptz,
  "doneAt"          timestamptz,
  "doneByUserId"    text,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "OpsReminder" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "OpsReminder_status_dueAt_idx"          ON "OpsReminder" ("status", "dueAt");
CREATE INDEX IF NOT EXISTS "OpsReminder_assigneeUserId_status_idx" ON "OpsReminder" ("assigneeUserId", "status");
CREATE INDEX IF NOT EXISTS "OpsReminder_createdByUserId_status_idx" ON "OpsReminder" ("createdByUserId", "status");
