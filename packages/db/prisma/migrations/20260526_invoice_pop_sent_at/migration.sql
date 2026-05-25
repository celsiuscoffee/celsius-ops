-- Track when a Proof-Of-Payment was last sent to the supplier via the
-- staff/native app's Send-POP WhatsApp deeplink. Used to:
--   1. show a "POP sent" pill on paid invoices in the list, and
--   2. let the user filter for paid-but-POP-not-sent invoices, which is
--      the actionable backlog for finance/procurement.
--
-- Resending a POP overwrites this timestamp — we don't keep a ledger of
-- individual sends. If audit-grade history becomes a need, promote to
-- an InvoicePopSend table later.
--
-- Applied to production on 2026-05-26 via Supabase MCP apply_migration
-- with name "invoice_pop_sent_at". This file mirrors that change so the
-- Prisma migration history stays aligned with the DB.

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "popSentAt" TIMESTAMP(3);
