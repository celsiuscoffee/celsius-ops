-- Hot-path indexes for pos_orders / pos_order_items.
--
-- These tables had no secondary indexes: the sales dashboards range-scan
-- created_at (20k-row windows), filter by outlet, dedup customer_phone
-- (50k-row fetch today, COUNT(DISTINCT) once moved into SQL), and every
-- `pos_order_items(...)` relation expansion nested-loops over an
-- unindexed FK (Postgres does not auto-index FK columns).
--
-- Apply note: plain CREATE INDEX takes a brief write lock — fine at
-- current size, run during a quiet window. If the tables are large by
-- the time this is applied, run each statement separately as
-- CREATE INDEX CONCURRENTLY (outside a transaction).

-- Dashboard time windows across all outlets.
CREATE INDEX IF NOT EXISTS idx_pos_orders_created
  ON pos_orders (created_at DESC);

-- Outlet-scoped dashboards / Z-report windows.
-- (pos_orders.outlet_id holds the POS code, e.g. outlet-con.)
CREATE INDEX IF NOT EXISTS idx_pos_orders_outlet_created
  ON pos_orders (outlet_id, created_at DESC);

-- Relation expansion pos_orders -> pos_order_items.
CREATE INDEX IF NOT EXISTS idx_pos_order_items_order
  ON pos_order_items (order_id);

-- Customer dedup / repeat-vs-new counts. Partial: most rows have no
-- phone attached, so keep the index to the ones that matter.
CREATE INDEX IF NOT EXISTS idx_pos_orders_customer_phone
  ON pos_orders (customer_phone)
  WHERE customer_phone IS NOT NULL;
