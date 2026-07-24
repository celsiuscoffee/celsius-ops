-- Persist Grab's per-order commission/fees on pos_orders so GL Grab clearing
-- can be ACTUAL-based instead of rate-derived.
--
-- Found in the app-data-point QA sweep 2026-07-24: grab-ingest.ts computes
-- merchantChargeFee + serviceChargeFee at ingest, folds them into `total`, then
-- discards the split; pos_orders had no commission column. These columns capture
-- it going forward.
--
-- VERIFIED CAVEAT: Grab's webhook / Partner-API price object currently sends
-- BOTH fee fields = 0 for every order (checked against grab_webhook_events.raw).
-- The real per-order commission is only in the GrabMerchant settlement portal
-- exports — no received payload carries it. So the ingest wiring treats 0/absent
-- as NULL (unknown), never a false zero, and these columns populate only if a
-- payload ever carries a real fee. The actual month-end commission still comes
-- from the settlement side (grab_ads_spend-style import), which is why the GL
-- Grab clearing (close-prep.ts) remains rate-derived (exact:false) for now — a
-- settlement importer is the real fix and is proposed in the QA register.
--
-- All amounts are in SEN (integer, ÷100 for RM), matching pos_orders.total.
-- Nullable: historical rows and non-Grab orders stay NULL; a Grab order with
-- fee data present writes the columns going forward + via the raw backfill.
--
-- Applied to prod 2026-07-24 via Supabase MCP (apply_migration:
-- pos_orders_grab_commission), finance-warehouse custodian — additive columns
-- only, no backfill of existing values in this DDL (done separately from
-- grab_webhook_events.raw). pos_orders is SQL/RPC-managed (not in Prisma).

ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS grab_merchant_charge_fee integer,
  ADD COLUMN IF NOT EXISTS grab_service_charge_fee integer,
  ADD COLUMN IF NOT EXISTS grab_commission_total integer,
  ADD COLUMN IF NOT EXISTS grab_delivery_fee integer;

COMMENT ON COLUMN pos_orders.grab_commission_total IS
  'Grab per-order commission in sen = merchantChargeFee + serviceChargeFee, captured at ingest (grab-ingest.ts). Feeds actual-based GL 6519 Merchant fees clearing.';
