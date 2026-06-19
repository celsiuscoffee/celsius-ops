-- Packaging on the menu BOM + per-channel (dine-in / takeaway) costing.
--
-- 1. ItemType gains PACKAGING so cups / lids / straws / tissues are first-class
--    inventory products (priced, stock-counted, par-levelled) just like
--    ingredients, and flow through the existing cheapest-supplier-price costing.
-- 2. New ServiceMode enum scopes a BOM line to a fulfillment channel. Mirrors
--    pos_order_items.fulfillment (dine_in / takeaway) so per-channel COGS can be
--    costed exactly from native POS lines later (Tier 2).
-- 3. MenuIngredient (the generic BOM-line table) gains serviceMode, default ALL
--    so every existing ingredient line is unchanged. The unique key widens to
--    include serviceMode so the same product can appear once per channel.
--
-- Applied to production via Supabase MCP apply_migration. Manual SQL only —
-- never `prisma db push`. See docs/database-migrations.md.

-- 1. PACKAGING item type (idempotent; safe to use only in later statements/txns)
ALTER TYPE "ItemType" ADD VALUE IF NOT EXISTS 'PACKAGING';

-- 2. ServiceMode enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ServiceMode') THEN
    CREATE TYPE "ServiceMode" AS ENUM ('ALL', 'DINE_IN', 'TAKEAWAY');
  END IF;
END$$;

-- 3. BOM line gains a channel scope. Existing rows default to ALL, so current
--    ingredient costing is byte-for-byte unchanged.
ALTER TABLE "MenuIngredient"
  ADD COLUMN IF NOT EXISTS "serviceMode" "ServiceMode" NOT NULL DEFAULT 'ALL';

-- Widen uniqueness to (menu, product, channel): a product may appear once per
-- channel (e.g. a takeaway-only cup alongside a both-ways ALL straw).
DROP INDEX IF EXISTS "MenuIngredient_menuId_productId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "MenuIngredient_menuId_productId_serviceMode_key"
  ON "MenuIngredient" ("menuId", "productId", "serviceMode");
