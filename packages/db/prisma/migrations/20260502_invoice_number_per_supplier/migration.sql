-- Scope invoice-number uniqueness to per-supplier instead of global.
-- Two different suppliers can legitimately both issue an invoice numbered
-- "INV-001"; the global unique constraint blocked that and forced fake
-- prefixes. Per-supplier uniqueness mirrors how accounting systems work.
--
-- NULL supplierId is treated as DISTINCT in Postgres unique indexes by
-- default, so vendor / staff-claim invoices (no supplier record) won't
-- collide with each other on invoice number alone.
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_invoiceNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_supplierId_invoiceNumber_key"
  ON "Invoice" ("supplierId", "invoiceNumber");
