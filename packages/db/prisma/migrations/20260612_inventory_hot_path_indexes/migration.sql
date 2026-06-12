-- Reconciliation, not new DDL: these indexes were verified ALREADY LIVE
-- on production (pg_indexes, 2026-06-12) but existed nowhere in the
-- repo — applied directly to the DB at some point without a committed
-- migration file. schema.prisma now declares them; this file records
-- the SQL so a fresh rebuild (baseline + migrations) recreates them.
-- IF NOT EXISTS makes it a no-op against the current database.
--
-- Live extras deliberately NOT declared in schema.prisma:
--   * Invoice_paidAt_idx — partial (WHERE "paidAt" IS NOT NULL);
--     Prisma's schema language can't express partial indexes.
--   * idx_Invoice_outletId — duplicate of Invoice_outletId_idx
--     (same column); candidate for DROP in a cleanup pass.

CREATE INDEX IF NOT EXISTS "Order_outletId_createdAt_idx"
  ON "Order" ("outletId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Order_status_createdAt_idx"
  ON "Order" (status, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Invoice_outletId_idx"
  ON "Invoice" ("outletId");

CREATE INDEX IF NOT EXISTS "Invoice_status_dueDate_idx"
  ON "Invoice" (status, "dueDate");
