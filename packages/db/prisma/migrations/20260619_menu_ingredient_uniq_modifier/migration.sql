-- Widen MenuIngredient uniqueness to include the temperature condition so the
-- SAME product can appear once per (menu, channel, temperature). This lets a
-- recipe carry one ingredient at two quantities by temperature — e.g. Fresh
-- Milk 120ml on Hot and 150ml on Iced — instead of being capped at one line per
-- (menu, product, channel).
--
-- Applied to production via Supabase MCP apply_migration. Manual SQL only —
-- never `prisma db push`. See docs/database-migrations.md.

DROP INDEX IF EXISTS "MenuIngredient_menuId_productId_serviceMode_key";
CREATE UNIQUE INDEX IF NOT EXISTS "MenuIngredient_menuId_productId_serviceMode_modifier_key"
  ON "MenuIngredient" ("menuId", "productId", "serviceMode", "modifier");
