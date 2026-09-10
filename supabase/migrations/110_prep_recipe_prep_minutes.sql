-- Applied to production 2026-09-08 (owner-approved, hard rule 6).
-- Audit-trail twin: packages/db/prisma/migrations/20260905_prep_recipe_prep_minutes/migration.sql
--
-- prepMinutes = hands-on minutes for ONE person to produce one batch (the
-- recipe's yieldQuantity). Minutes per prepped unit is prepMinutes /
-- yieldQuantity, which the prep-labour report multiplies by the units sales
-- actually consumed to get required manhours.
--
-- NULLABLE on purpose: an untimed recipe must read as "not timed yet", never
-- as zero work. At apply time all 14 recipes were NULL — nothing backfilled.

ALTER TABLE "ProductRecipe" ADD COLUMN IF NOT EXISTS "prepMinutes" DECIMAL(10,2);

COMMENT ON COLUMN "ProductRecipe"."prepMinutes" IS
  'Hands-on minutes for ONE person to produce one batch (yieldQuantity). NULL = not timed yet.';
