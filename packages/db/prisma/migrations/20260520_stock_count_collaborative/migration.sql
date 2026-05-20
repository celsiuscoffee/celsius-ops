-- Collaborative stock counts: track per-item authorship + finalization audit,
-- and enable Supabase realtime on StockCountItem so contributors see each
-- other's saves without refreshing.
--
-- Applied to production on 2026-05-20 via Supabase MCP apply_migration with
-- name "stock_count_collaborative". This file mirrors that change so the
-- Prisma migration history stays aligned with the DB.

ALTER TABLE "StockCountItem"
  ADD COLUMN IF NOT EXISTS "countedById" TEXT,
  ADD COLUMN IF NOT EXISTS "countedAt"   TIMESTAMP(3);

ALTER TABLE "StockCountItem"
  ADD CONSTRAINT "StockCountItem_countedById_fkey"
  FOREIGN KEY ("countedById") REFERENCES "User"(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Unique key needed for upsert-by-product within a count session. Note:
-- (productId, productPackageId) where productPackageId IS NULL still allows
-- one row per stockCount (Postgres NULL-distinct), which matches the model
-- that each (product, package) pair has at most one StockCountItem per count.
CREATE UNIQUE INDEX IF NOT EXISTS "StockCountItem_count_product_pkg_key"
  ON "StockCountItem" ("stockCountId", "productId", "productPackageId");

-- Finalization audit — whoever tapped "Finalize Count" (could differ from
-- the count's starter in a collaborative session).
ALTER TABLE "StockCount"
  ADD COLUMN IF NOT EXISTS "finalizedById" TEXT,
  ADD COLUMN IF NOT EXISTS "finalizedAt"   TIMESTAMP(3);

ALTER TABLE "StockCount"
  ADD CONSTRAINT "StockCount_finalizedById_fkey"
  FOREIGN KEY ("finalizedById") REFERENCES "User"(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Enable realtime publication for StockCountItem so frontend subscribers
-- get INSERT/UPDATE/DELETE events on the active count.
ALTER PUBLICATION supabase_realtime ADD TABLE "StockCountItem";
