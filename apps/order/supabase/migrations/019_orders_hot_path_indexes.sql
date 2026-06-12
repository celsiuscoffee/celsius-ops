-- Hot-path indexes for the customer pickup `orders` / `order_items`.
--
-- Aside from idx_orders_wallet_voucher_id, these tables had no
-- secondary indexes: the backoffice pickup endpoint filters by
-- store_id / status / created_at windows, the sales dashboards
-- range-scan created_at and dedup customer_phone, and every
-- `order_items(*)` relation expansion nested-loops over an unindexed
-- FK (Postgres does not auto-index FK columns).
--
-- Apply note: plain CREATE INDEX takes a brief write lock — fine at
-- current size, run during a quiet window. If the tables are large by
-- the time this is applied, run each statement separately as
-- CREATE INDEX CONCURRENTLY (outside a transaction).

-- Dashboard time windows across all stores.
CREATE INDEX IF NOT EXISTS idx_orders_created
  ON orders (created_at DESC);

-- Store-scoped lists (KDS panel, store dashboards, realtime reload).
CREATE INDEX IF NOT EXISTS idx_orders_store_created
  ON orders (store_id, created_at DESC);

-- Active-order queues: status IN ('paid','preparing','ready'), newest
-- first, no time bound — without this it's a full scan per poll.
CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders (status, created_at DESC);

-- Relation expansion orders -> order_items.
CREATE INDEX IF NOT EXISTS idx_order_items_order
  ON order_items (order_id);

-- Customer dedup / repeat-vs-new counts. Partial: rows without a phone
-- don't participate.
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone
  ON orders (customer_phone)
  WHERE customer_phone IS NOT NULL;
