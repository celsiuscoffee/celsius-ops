-- WhatsApp Cloud API message store for the supplier-chat monitor / inbox.
-- Captured for reproducibility per docs/database-migrations.md (never auto-run;
-- already applied to the celsius-inventory DB via Supabase MCP). Matches model
-- WhatsAppMessage in packages/db/prisma/schema.prisma.
--
-- RLS is enabled because this holds supplier phone numbers + chat content; the
-- app reaches it only via Prisma (privileged connection, bypasses RLS), so no
-- policies are needed — same posture as the other Prisma-owned tables.

CREATE TABLE IF NOT EXISTS "WhatsAppMessage" (
  "id"          text PRIMARY KEY,
  "waMessageId" text UNIQUE,
  "direction"   text NOT NULL,
  "fromNumber"  text NOT NULL,
  "toNumber"    text NOT NULL,
  "supplierId"  text,
  "type"        text NOT NULL DEFAULT 'text',
  "body"        text,
  "mediaUrl"    text,
  "status"      text,
  "raw"         jsonb,
  "timestamp"   timestamptz NOT NULL DEFAULT now(),
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "WhatsAppMessage" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "WhatsAppMessage_fromNumber_idx" ON "WhatsAppMessage" ("fromNumber");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_toNumber_idx"   ON "WhatsAppMessage" ("toNumber");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_supplierId_idx" ON "WhatsAppMessage" ("supplierId");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_timestamp_idx"  ON "WhatsAppMessage" ("timestamp");
