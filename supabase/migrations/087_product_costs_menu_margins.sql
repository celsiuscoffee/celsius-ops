-- COGS activation W2+W3+W4 (docs/design/cogs-activation.md).
-- Applied 2026-07-18 via Supabase MCP (apply_migration:
-- product_costs_menu_margins) in-session, continuing the owner-approved
-- COGS activation build.
--
-- W3: product_costs — cost per BASE unit (g/ml/pcs) per ingredient product,
--     derived on the fly from the last 5 received PO lines
--     (OrderItem.unitPrice ÷ ProductPackage.conversionFactor), overridable
--     via product_cost_overrides.manual_cost. A VIEW, not a cron: always
--     fresh, and never risks the 40-cron Vercel cap.
-- W4: menu_margins — sellingPrice − channel-weighted recipe cost per menu
--     item (first-ever margin per drink). Packaging cost deliberately NOT
--     included in v1 (packaging-rules integration is a follow-up).
-- W2 (partial): backfill ReceivingItem.productPackageId where the product
--     has exactly ONE package (unambiguous; ~848 rows at authoring).
--     Receiving-flow default for new rows is a separate code change.

-- Manual cost overrides (server-only; service role bypasses RLS).
CREATE TABLE IF NOT EXISTS product_cost_overrides (
  product_id  text PRIMARY KEY,
  manual_cost numeric(12,6) NOT NULL CHECK (manual_cost >= 0),
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE product_cost_overrides ENABLE ROW LEVEL SECURITY;

-- W2 backfill: unambiguous single-package products only.
UPDATE "ReceivingItem" ri
SET "productPackageId" = pp.id
FROM "ProductPackage" pp
WHERE ri."productPackageId" IS NULL
  AND pp."productId" = ri."productId"
  AND (SELECT count(*) FROM "ProductPackage" pp2 WHERE pp2."productId" = ri."productId") = 1;

-- W3: cost per base unit.
CREATE OR REPLACE VIEW product_costs AS
WITH po_lines AS (
  SELECT oi."productId" AS product_id,
         oi."unitPrice" / pp."conversionFactor" AS unit_cost,
         r."receivedAt",
         row_number() OVER (PARTITION BY oi."productId" ORDER BY r."receivedAt" DESC) AS rn
  FROM "OrderItem" oi
  JOIN "Order" o ON o.id = oi."orderId" AND o."orderType" = 'PURCHASE_ORDER'
  JOIN "Receiving" r ON r."orderId" = o.id
  JOIN "ProductPackage" pp ON pp.id = COALESCE(
    oi."productPackageId",
    (SELECT pp2.id FROM "ProductPackage" pp2
      WHERE pp2."productId" = oi."productId"
        AND (SELECT count(*) FROM "ProductPackage" pp3 WHERE pp3."productId" = oi."productId") = 1)
  )
  WHERE oi."unitPrice" > 0 AND pp."conversionFactor" > 0
), derived AS (
  SELECT product_id,
         avg(unit_cost) FILTER (WHERE rn <= 5) AS derived_cost,
         count(*) FILTER (WHERE rn <= 5)       AS receipts_used,
         max("receivedAt")                     AS last_receipt_at
  FROM po_lines
  GROUP BY product_id
)
SELECT p.id AS product_id,
       p.name,
       p."baseUom" AS base_uom,
       COALESCE(o.manual_cost, d.derived_cost) AS cost_per_base,
       CASE WHEN o.manual_cost IS NOT NULL THEN 'manual'
            WHEN d.derived_cost IS NOT NULL THEN 'derived'
            ELSE 'uncosted' END AS costed_via,
       COALESCE(d.receipts_used, 0) AS receipts_used,
       d.last_receipt_at
FROM "Product" p
LEFT JOIN derived d ON d.product_id = p.id
LEFT JOIN product_cost_overrides o ON o.product_id = p.id;

-- W4: margin per menu item. Recipe lines are channel-weighted the same way
-- the consumption engine weights them (ALL=1, DINE_IN/TAKEAWAY=0.5 expected
-- cost), so alternative-packaging lines don't double-count.
CREATE OR REPLACE VIEW menu_margins AS
SELECT m.id AS menu_id,
       m.name,
       m.category,
       m."sellingPrice" AS selling_price,
       round(sum(mi."quantityUsed"
                 * CASE WHEN mi."serviceMode" = 'ALL' THEN 1 ELSE 0.5 END
                 * pc.cost_per_base)::numeric, 4) AS recipe_cost,
       count(*) FILTER (WHERE pc.cost_per_base IS NULL) AS uncosted_ingredients,
       round((m."sellingPrice" - sum(mi."quantityUsed"
                 * CASE WHEN mi."serviceMode" = 'ALL' THEN 1 ELSE 0.5 END
                 * pc.cost_per_base))::numeric, 4) AS margin,
       round((100 * (m."sellingPrice" - sum(mi."quantityUsed"
                 * CASE WHEN mi."serviceMode" = 'ALL' THEN 1 ELSE 0.5 END
                 * pc.cost_per_base)) / nullif(m."sellingPrice", 0))::numeric, 1) AS margin_pct
FROM "Menu" m
JOIN "MenuIngredient" mi ON mi."menuId" = m.id
LEFT JOIN product_costs pc ON pc.product_id = mi."productId"
GROUP BY m.id, m.name, m.category, m."sellingPrice";
