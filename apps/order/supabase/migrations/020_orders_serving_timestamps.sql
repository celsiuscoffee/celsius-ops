-- Serving-time instrumentation for the pickup `orders` table.
--
-- An order's `updated_at` is bumped by a trigger on every write, so it can't mark
-- the moment an order became ready (the later "completed" write overwrites it).
-- These dedicated timestamps are stamped when the kitchen advances an order to
-- "ready" / "completed" (the pickup status route + the on-register order panel via
-- /api/pos/order-status), letting the Area Scorecard measure speed of service
-- (ready_at - created_at) per outlet.
--
-- Additive + nullable + idempotent.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS ready_at     timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Per-outlet serving-time aggregate (orders that reached "ready" in a period).
CREATE INDEX IF NOT EXISTS idx_orders_ready_at
  ON orders (store_id, ready_at)
  WHERE ready_at IS NOT NULL;
