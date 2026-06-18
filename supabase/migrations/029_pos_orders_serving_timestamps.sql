-- Serving-time instrumentation for pos_orders (Grab + any kitchen-bumped sale).
--
-- pos_orders are created already status='completed' at the till (create_pos_sale),
-- so the order STATUS is not a "served" signal. The only kitchen-bump event that
-- exists is the on-register order panel advancing a queued (Grab) order to
-- "ready" / "completed" via /api/pos/order-status. We stamp dedicated timestamps
-- there so speed-of-service can be measured (ready_at - created_at) without
-- relying on updated_at (which any later write overwrites).
--
-- Additive + nullable + idempotent: safe to (re)apply, never blocks an insert.

ALTER TABLE public.pos_orders
  ADD COLUMN IF NOT EXISTS ready_at     timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Supports the Area Scorecard's per-outlet serving-time aggregate
-- (avg over orders that reached "ready" in a period, grouped by outlet).
CREATE INDEX IF NOT EXISTS idx_pos_orders_ready_at
  ON public.pos_orders (outlet_id, ready_at)
  WHERE ready_at IS NOT NULL;
