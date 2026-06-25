-- WhatsApp Cloud API message store for the supplier-chat + ops chat inboxes.
-- Captured for reproducibility per docs/database-migrations.md (never auto-run).
-- IMPORTANT: apply to the LIVE backoffice DB — the project Prisma's DATABASE_URL
-- points to, which holds User / OpsAlert / Supplier ("celsiuscoffee's Project",
-- ref kqdcdhpnyuwrxqhbuyfl). It was first applied ONLY to the separate
-- "celsius-inventory" project, so every recordInbound/OutboundMessage write hit
-- a missing table, silently no-op'd (those helpers swallow errors), and both
-- inboxes stayed empty. Re-applied to the live DB 2026-06-25. Matches model
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
