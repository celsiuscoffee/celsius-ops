-- APPLIED to production 2026-06-12 (Supabase migration
-- hot_path_phone_and_status_indexes).
--
-- Verified against live pg_indexes first: pos_orders already had
-- (created_at DESC) and (outlet_id, status), and pos_order_items
-- already had (order_id) — all applied directly to the DB at some
-- point without committed migration files. The only genuine gap was
-- the customer-phone index below.

-- Customer dedup / repeat-vs-new counts on the sales dashboards, and
-- the COUNT(DISTINCT customer_phone) SQL aggregate that replaces the
-- 50k-row phone fetch. Partial: most rows have no phone attached.
CREATE INDEX IF NOT EXISTS idx_pos_orders_customer_phone
  ON pos_orders (customer_phone)
  WHERE customer_phone IS NOT NULL;
