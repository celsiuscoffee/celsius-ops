-- 057_whatsapp_messages.sql
-- Conversation store for the WhatsApp Cloud API supplier-chat monitor/inbox.
--
-- Every inbound (webhook) and outbound (our sends) message is persisted here so
-- the team can monitor all supplier chats, a BackOffice inbox can render threads,
-- and the AI can learn from / act on the stream. Foundation for Option 1.
--
-- Column names are camelCase + quoted to match the Prisma model (WhatsAppMessage)
-- — Prisma maps field names to column names verbatim. supplierId is a SOFT link
-- (no FK) matched by phone, since supplier numbers aren't guaranteed clean/unique.

CREATE TABLE IF NOT EXISTS "WhatsAppMessage" (
  "id"          text PRIMARY KEY,
  "waMessageId" text UNIQUE,                       -- WhatsApp wamid (idempotency)
  "direction"   text NOT NULL,                     -- 'inbound' | 'outbound'
  "fromNumber"  text NOT NULL,                     -- E.164 digits
  "toNumber"    text NOT NULL,                     -- E.164 digits
  "supplierId"  text,                              -- soft link to Supplier.id (by phone)
  "type"        text NOT NULL DEFAULT 'text',      -- text | image | document | template | ...
  "body"        text,                              -- text body / caption
  "mediaUrl"    text,
  "status"      text,                              -- outbound delivery status
  "raw"         jsonb,                             -- full payload, for audit + AI
  "timestamp"   timestamptz NOT NULL DEFAULT now(),
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "WhatsAppMessage_fromNumber_idx" ON "WhatsAppMessage" ("fromNumber");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_toNumber_idx"   ON "WhatsAppMessage" ("toNumber");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_supplierId_idx" ON "WhatsAppMessage" ("supplierId");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_timestamp_idx"  ON "WhatsAppMessage" ("timestamp");
