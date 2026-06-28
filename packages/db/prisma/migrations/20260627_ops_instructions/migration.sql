-- Ops Workspace: WhatsApp instructions + reminder notify-state. Apply to the
-- LIVE backoffice DB (the one Prisma's DATABASE_URL points at — "celsiuscoffee's
-- Project", ref kqdcdhpnyuwrxqhbuyfl), same as OpsAlert / OpsReminder. Additive
-- only (one new column + two new tables); never auto-run — apply via the
-- Supabase SQL editor / MCP. Matches models OpsInstruction /
-- OpsInstructionRecipient and the OpsReminder.lastNotifiedAt column in
-- packages/db/prisma/schema.prisma.
--
-- RLS is enabled (these tables name staff + carry operational copy); the app
-- reaches them only via Prisma's privileged connection (bypasses RLS), so no
-- policies are needed — same posture as the other Prisma-owned ops tables.

-- 1) Reminder notify-state: when the assignee was last WhatsApp'd about it.
ALTER TABLE "OpsReminder" ADD COLUMN IF NOT EXISTS "lastNotifiedAt" timestamptz;

-- 2) Instruction header (one row per directive sent).
CREATE TABLE IF NOT EXISTS "OpsInstruction" (
  "id"              text PRIMARY KEY,
  "title"           text NOT NULL,
  "body"            text NOT NULL,
  "severity"        text NOT NULL DEFAULT 'normal',
  "createdByUserId" text NOT NULL,
  "audience"        jsonb NOT NULL,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "OpsInstruction" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "OpsInstruction_createdAt_idx"
  ON "OpsInstruction" ("createdAt");
CREATE INDEX IF NOT EXISTS "OpsInstruction_createdByUserId_createdAt_idx"
  ON "OpsInstruction" ("createdByUserId", "createdAt");

-- 3) Per-recipient delivery + acknowledgement state.
CREATE TABLE IF NOT EXISTS "OpsInstructionRecipient" (
  "id"                text PRIMARY KEY,
  "instructionId"     text NOT NULL REFERENCES "OpsInstruction"("id") ON DELETE CASCADE,
  "userId"            text,
  "name"              text NOT NULL,
  "phone"             text,
  "deliveryStatus"    text NOT NULL DEFAULT 'pending',
  "error"             text,
  "providerMessageId" text,
  "sentAt"            timestamptz,
  "ackedAt"           timestamptz,
  "createdAt"         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "OpsInstructionRecipient" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "OpsInstructionRecipient_instructionId_idx"
  ON "OpsInstructionRecipient" ("instructionId");
CREATE INDEX IF NOT EXISTS "OpsInstructionRecipient_userId_ackedAt_idx"
  ON "OpsInstructionRecipient" ("userId", "ackedAt");
