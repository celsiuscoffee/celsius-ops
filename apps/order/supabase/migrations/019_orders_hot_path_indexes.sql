-- APPLIED to production 2026-06-12 (Supabase migration
-- hot_path_phone_and_status_indexes).
--
-- Verified against live pg_indexes first: orders already had
-- (created_at DESC) and (store_id, status), and order_items already
-- had (order_id) — twice, in fact: idx_order_items_order AND
-- idx_order_items_order_id are identical duplicates (candidate for
-- DROP in a cleanup pass). All were applied directly to the DB at some
-- point without committed migration files. The genuine gaps were the
-- two indexes below.

-- Active-order queues: status IN ('paid','preparing','ready') across
-- all stores, newest first (backoffice pickup dashboard).
CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders (status, created_at DESC);

-- Customer dedup / repeat-vs-new counts. Partial: rows without a
-- phone don't participate.
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone
  ON orders (customer_phone)
  WHERE customer_phone IS NOT NULL;
