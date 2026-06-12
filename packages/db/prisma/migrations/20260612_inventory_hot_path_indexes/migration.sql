-- Hot-path composite indexes for the PO + finance dashboards.
-- "Order" here is the inventory PURCHASE ORDER model (not customer
-- orders — those live in the app-level `orders` / `pos_orders` tables,
-- indexed by supabase/migrations/023 and apps/order migration 019).
--
-- Both tables previously had no outlet/status index at all, so every
-- dashboard list view ("pending POs for outlet X, newest first",
-- "overdue invoices by outlet") full-scans as data grows.
--
-- Apply note: tables are small today, so plain CREATE INDEX (brief
-- write lock) is fine. If applying later against large live tables,
-- run each statement separately as CREATE INDEX CONCURRENTLY (outside
-- a transaction) instead.

CREATE INDEX IF NOT EXISTS "Order_outletId_status_createdAt_idx"
  ON "Order" ("outletId", "status", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Invoice_outletId_status_createdAt_idx"
  ON "Invoice" ("outletId", "status", "createdAt" DESC);
