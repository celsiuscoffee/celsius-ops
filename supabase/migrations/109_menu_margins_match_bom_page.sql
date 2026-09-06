-- menu_margins v2 — make the view agree with the catalog BOM page
-- (apps/backoffice /api/inventory/menus), which is the canonical costing
-- engine (owner ruling 2026-09-02: "the BOM page should always be the BOM
-- source"). The v1 view (087) disagreed with the page in three ways that
-- made its margins wrong:
--   1. It costed ingredients via product_costs (last-5-received-PO average),
--      which divides carton prices by wrong conversion factors for the
--      cf=1-carton SKUs (e.g. Sandwich Box at RM56/pc) — the page uses the
--      cheapest ACTIVE non-ADHOC SupplierProduct catalog price ÷ conversion
--      factor instead.
--   2. It billed every modifier row at full/half weight, so optional
--      add-ons (Extra Shot, Oatmilk swap) and BOTH temperature variants
--      (Iced + Hot syrup lines) stacked into one cost — Roti Bakar Brioche
--      showed −354% margin.
--   3. It ignored PackagingRule lines entirely (cups/lids/straws/boxes), so
--      drink margins were overstated by the packaging cost.
-- v2 mirrors the page: catalog costs, a Hot/Iced × dine-in/takeaway matrix
-- (modifier NULL = both temperatures; 'Iced'/'Hot' scope a line to that
-- variant; anything else is an optional add-on and excluded), and per-item
-- packaging rules folded in. Per-order rules (Grab carrier bag) remain
-- order-level and are NOT in per-item cost, same as the page.
--
-- Column compatibility: menu_id, name, category, selling_price, recipe_cost,
-- uncosted_ingredients, margin, margin_pct are kept (cashflow.ts reads name +
-- recipe_cost). recipe_cost is now the sales-mix-blended expected cost:
-- 64% iced / 36% hot (measured POS modifier mix, Aug 2026) × 50/50
-- dine-in/takeaway (outlets ranged 36–50% takeaway). The four raw matrix
-- cells and the per-channel worst-case (what the BOM page displays) are
-- exposed alongside for anything that wants exact numbers.

DROP VIEW IF EXISTS menu_margins;

CREATE VIEW menu_margins AS
WITH catalog_cost AS (
  SELECT sp."productId" AS product_id,
         min(sp.price / pp."conversionFactor") AS unit_cost
  FROM "SupplierProduct" sp
  JOIN "ProductPackage" pp
    ON pp.id = sp."productPackageId" AND pp."conversionFactor" > 0
  JOIN "Supplier" s ON s.id = sp."supplierId"
  WHERE sp."isActive" AND sp.price > 0
    AND coalesce(s."supplierCode", '') <> 'ADHOC'
  GROUP BY sp."productId"
),
lines AS (
  -- Recipe lines. modifier NULL = both temperatures; 'Iced'/'Hot' = that
  -- variant only; any other value (Extra Shot, Oatmilk) is an optional
  -- add-on chosen per order and excluded from base cost.
  SELECT mi."menuId" AS menu_id, mi."productId" AS product_id,
         mi."quantityUsed" AS qty, mi."serviceMode"::text AS chan, mi.modifier
  FROM "MenuIngredient" mi
  WHERE mi.modifier IS NULL OR mi.modifier IN ('Iced', 'Hot')
  UNION ALL
  -- Per-item packaging rules, exactly as the BOM page folds them in.
  SELECT m.id, r."productId", r.quantity, r.channel::text, r.modifier
  FROM "PackagingRule" r
  CROSS JOIN "Menu" m
  WHERE r."isActive" AND NOT r."perOrder"
    AND r.channel::text IN ('ALL', 'DINE_IN', 'TAKEAWAY')
    AND (r.scope = 'ALL'
         OR (r.scope = 'CATEGORY' AND coalesce(m.category, '') = coalesce(r.category, ''))
         OR (r.scope = 'ITEMS' AND m.id = ANY (r."menuIds")))
),
cells AS (
  SELECT l.menu_id,
    sum(l.qty * c.unit_cost) FILTER (WHERE l.chan IN ('ALL', 'DINE_IN')
      AND (l.modifier IS NULL OR l.modifier = 'Hot'))  AS hot_dine_in,
    sum(l.qty * c.unit_cost) FILTER (WHERE l.chan IN ('ALL', 'TAKEAWAY')
      AND (l.modifier IS NULL OR l.modifier = 'Hot'))  AS hot_takeaway,
    sum(l.qty * c.unit_cost) FILTER (WHERE l.chan IN ('ALL', 'DINE_IN')
      AND (l.modifier IS NULL OR l.modifier = 'Iced')) AS iced_dine_in,
    sum(l.qty * c.unit_cost) FILTER (WHERE l.chan IN ('ALL', 'TAKEAWAY')
      AND (l.modifier IS NULL OR l.modifier = 'Iced')) AS iced_takeaway,
    count(*) FILTER (WHERE c.unit_cost IS NULL)        AS uncosted_ingredients
  FROM lines l
  LEFT JOIN catalog_cost c ON c.product_id = l.product_id
  GROUP BY l.menu_id
)
SELECT m.id AS menu_id,
       m.name,
       m.category,
       m."sellingPrice" AS selling_price,
       -- Blended expected cost per unit sold (64/36 iced/hot, 50/50 channel).
       round((0.5 * (0.64 * ce.iced_dine_in  + 0.36 * ce.hot_dine_in)
            + 0.5 * (0.64 * ce.iced_takeaway + 0.36 * ce.hot_takeaway))::numeric, 4) AS recipe_cost,
       ce.uncosted_ingredients,
       round((m."sellingPrice"
            - (0.5 * (0.64 * ce.iced_dine_in  + 0.36 * ce.hot_dine_in)
             + 0.5 * (0.64 * ce.iced_takeaway + 0.36 * ce.hot_takeaway)))::numeric, 4) AS margin,
       round((100 * (m."sellingPrice"
            - (0.5 * (0.64 * ce.iced_dine_in  + 0.36 * ce.hot_dine_in)
             + 0.5 * (0.64 * ce.iced_takeaway + 0.36 * ce.hot_takeaway)))
            / nullif(m."sellingPrice", 0))::numeric, 1) AS margin_pct,
       -- What the BOM page shows per channel: the worst temperature.
       round(greatest(ce.hot_dine_in,  ce.iced_dine_in)::numeric, 4)  AS dine_in_cogs,
       round(greatest(ce.hot_takeaway, ce.iced_takeaway)::numeric, 4) AS takeaway_cogs,
       -- Raw matrix cells.
       round(ce.hot_dine_in::numeric, 4)   AS hot_dine_in_cogs,
       round(ce.hot_takeaway::numeric, 4)  AS hot_takeaway_cogs,
       round(ce.iced_dine_in::numeric, 4)  AS iced_dine_in_cogs,
       round(ce.iced_takeaway::numeric, 4) AS iced_takeaway_cogs
FROM "Menu" m
JOIN cells ce ON ce.menu_id = m.id;
