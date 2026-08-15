-- Recipe rows for the two modifiers that consume real stock.
--
-- Depends on 20260810_menu_ingredient_substitution (adds replacesProductId).
--
-- Oat milk: 726 drinks since July carried the "Oatmilk" modifier and oat milk
-- had no recipe line anywhere, so 115 L bought since June was invisible — while
-- those same drinks were still being billed for fresh milk they never used.
-- Both halves of the substitution were wrong.
--
-- The dose is not a guess. Oat milk stands in for the menu's own fresh-milk
-- quantity, so each row mirrors that menu's existing milk line (25–140 ml
-- depending on the drink). Deriving it from the milk rows rather than typing 32
-- numbers means it cannot drift from them. Reconciling CC001's July census on
-- exactly this rule landed within 1.3% of measured oat-milk usage.
--
-- Written for all 32 milk drinks, not just the 22 with oat sales to date — the
-- rows are inert unless a sale carries the modifier, and a customer can ask for
-- oat on any of them.

INSERT INTO "MenuIngredient" (id, "menuId", "productId", "quantityUsed", uom, "serviceMode", modifier, "replacesProductId")
SELECT
  gen_random_uuid()::text,
  mi."menuId",
  (SELECT id FROM "Product" WHERE sku = 'DO001'),   -- Oatmilk (Oatside), base ml
  mi."quantityUsed",                                 -- same volume as the fresh milk it replaces
  'ml',
  mi."serviceMode",
  'Oatmilk',
  mi."productId"                                     -- replaces Fresh Milk
FROM "MenuIngredient" mi
WHERE mi."productId" = (SELECT id FROM "Product" WHERE sku = 'DFM001')
  AND mi.modifier IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "MenuIngredient" x
    WHERE x."menuId" = mi."menuId"
      AND x."productId" = (SELECT id FROM "Product" WHERE sku = 'DO001')
      AND x.modifier = 'Oatmilk'
      AND x."serviceMode" = mi."serviceMode"
  );

-- Extra Shot: 227 since July, adding beans that nothing accounted for. Additive,
-- not a substitution — the shot is on top of the drink's existing dose.
--
-- 18 g matches the dose every coffee recipe already uses. Note that measured
-- consumption at CC001 runs ~2.4× the recipe (43.6 g/drink against 18 g), so if
-- that gap turns out to be the real dose rather than waste, THIS number moves
-- with the other 22 — it is deliberately consistent with them, not independently
-- correct.

INSERT INTO "MenuIngredient" (id, "menuId", "productId", "quantityUsed", uom, "serviceMode", modifier, "replacesProductId")
SELECT
  gen_random_uuid()::text,
  mi."menuId",
  mi."productId",                                    -- Home Blend (Collective)
  18,
  'g',
  'ALL',
  'Extra Shot',
  NULL
FROM "MenuIngredient" mi
WHERE mi."productId" = (SELECT id FROM "Product" WHERE sku = 'CB001')
  AND mi.modifier IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "MenuIngredient" x
    WHERE x."menuId" = mi."menuId"
      AND x."productId" = mi."productId"
      AND x.modifier = 'Extra Shot'
      AND x."serviceMode" = 'ALL'
  );
