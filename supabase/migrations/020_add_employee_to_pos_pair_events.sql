-- Upsell attribution for the cashier performance dashboard.
-- Tag each Pair-with-a-Bite ADD with the cashier (and, for a future order-exact
-- reconcile, the order). employee_id = User.id, the same id on
-- pos_orders.employee_id. Both nullable + best-effort so existing rows and the
-- fire-and-forget logger are unaffected. Applied live via MCP 2026-06-07.
ALTER TABLE public.pos_pair_events
  ADD COLUMN IF NOT EXISTS employee_id text,
  ADD COLUMN IF NOT EXISTS order_id text;
