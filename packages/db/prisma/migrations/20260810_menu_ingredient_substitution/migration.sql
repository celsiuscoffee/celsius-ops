-- Modifier-driven ingredient substitution.
--
-- MenuIngredient.modifier already scopes a line to a temperature ("Hot"/"Iced"),
-- which is additive: the line applies when that modifier is present. That is the
-- right shape for a dose that varies, and the wrong one for an ingredient SWAP.
--
-- Oat milk is the case that forced this. 726 drinks since July carried the
-- "Oatmilk" modifier, and oat milk has no recipe line at all — 115 L bought
-- since June with usage entirely invisible. A line scoped to "Oatmilk" would
-- pour oat milk in ON TOP of the menu's fresh milk and bill both, because the
-- fresh-milk line is null-scoped and always applies.
--
-- replacesProductId says "this line stands in for that product" — when the
-- modifier is present, the replaced product's lines are dropped and this one
-- takes their place. Additive lines leave it null and behave exactly as before.

ALTER TABLE "MenuIngredient"
  ADD COLUMN IF NOT EXISTS "replacesProductId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MenuIngredient_replacesProductId_fkey'
  ) THEN
    ALTER TABLE "MenuIngredient"
      ADD CONSTRAINT "MenuIngredient_replacesProductId_fkey"
      FOREIGN KEY ("replacesProductId") REFERENCES "Product"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Substitution is only meaningful on a modifier-scoped line: without a modifier
-- the line always applies, so "replaces" would mean the replaced ingredient is
-- never used and the recipe should simply name the right product instead.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MenuIngredient_replaces_needs_modifier'
  ) THEN
    ALTER TABLE "MenuIngredient"
      ADD CONSTRAINT "MenuIngredient_replaces_needs_modifier"
      CHECK ("replacesProductId" IS NULL OR "modifier" IS NOT NULL);
  END IF;
END $$;

-- A line cannot replace itself.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MenuIngredient_replaces_not_self'
  ) THEN
    ALTER TABLE "MenuIngredient"
      ADD CONSTRAINT "MenuIngredient_replaces_not_self"
      CHECK ("replacesProductId" IS NULL OR "replacesProductId" <> "productId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "MenuIngredient_replacesProductId_idx"
  ON "MenuIngredient" ("replacesProductId");
