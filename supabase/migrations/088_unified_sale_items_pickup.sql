-- Adds the pickup app (public.orders / order_items) as a fourth branch of
-- unified_sale_items — the product-level follow-up promised in migration 085
-- when the pickup channel was added to unified_sales. Same conventions:
--   - money in order_items is stored in SEN -> divide by 100
--   - the paid-status filter is BAKED IN (paid/preparing/ready/collected/
--     completed), matching the unified_sales pickup branch exactly
--   - outlet mapping via "Outlet"."pickupStoreId" = orders.store_id
--     (same INNER JOIN semantics as 085: an outlet without pickupStoreId
--     contributes no rows)
-- The three existing branches (hubbo, storehub, pos_native) are reproduced
-- unchanged from the live view definition.
--
-- Applied to prod 2026-07-18 via Supabase MCP (apply_migration:
-- unified_sale_items_pickup), finance-warehouse custodian rung-1 additive
-- derivation (follow-up pre-announced in 085).

CREATE OR REPLACE VIEW unified_sale_items AS
 SELECT 'hubbo'::text AS source,
    i.sale_id::text AS sale_id,
    h.outlet_id,
    h.transaction_time AS txn_at,
    (h.transaction_time AT TIME ZONE 'Asia/Kuala_Lumpur'::text)::date AS biz_date,
    i.name AS product_name,
    i.variant,
    i.quantity,
    i.unit_price,
    i.quantity * i.unit_price AS line_total
   FROM hubbo_sale_items i
     JOIN hubbo_sales h ON h.id = i.sale_id
  WHERE h.transaction_time <
        CASE h.outlet_id
            WHEN '89b19c9f-b1e0-42fe-a404-6d1a472e34c5'::text THEN '2026-01-02 16:00:00+00'::timestamptz
            WHEN 'b3b6299e-09dc-4f4a-80ef-bbc04316d324'::text THEN '2026-01-20 16:00:00+00'::timestamptz
            ELSE '2099-12-31 16:00:00+00'::timestamptz
        END
UNION ALL
 SELECT 'storehub'::text AS source,
    si.sale_id::text AS sale_id,
    s.outlet_id,
    s.transaction_time AS txn_at,
    (s.transaction_time AT TIME ZONE 'Asia/Kuala_Lumpur'::text)::date AS biz_date,
    si.name AS product_name,
    NULL::text AS variant,
    si.quantity,
    si.unit_price,
    si.total AS line_total
   FROM storehub_sale_items si
     JOIN storehub_sales s ON s.id = si.sale_id
  WHERE s.transaction_time >=
        CASE s.outlet_id
            WHEN '89b19c9f-b1e0-42fe-a404-6d1a472e34c5'::text THEN '2026-01-02 16:00:00+00'::timestamptz
            WHEN 'b3b6299e-09dc-4f4a-80ef-bbc04316d324'::text THEN '2026-01-20 16:00:00+00'::timestamptz
            ELSE '1899-12-31 16:00:00+00'::timestamptz
        END AND s.transaction_time <
        CASE s.outlet_id
            WHEN '89b19c9f-b1e0-42fe-a404-6d1a472e34c5'::text THEN '2026-06-07 16:00:00+00'::timestamptz
            WHEN 'b3b6299e-09dc-4f4a-80ef-bbc04316d324'::text THEN '2026-06-14 16:00:00+00'::timestamptz
            WHEN '5d1f2731-1985-4e54-a6df-3990e7d5c159'::text THEN '2026-06-17 16:00:00+00'::timestamptz
            ELSE '2099-12-31 16:00:00+00'::timestamptz
        END
UNION ALL
 SELECT 'pos_native'::text AS source,
    pi.order_id AS sale_id,
    m.canonical_id AS outlet_id,
    p.created_at AS txn_at,
    (p.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'::text)::date AS biz_date,
    pi.product_name,
    pi.variant_name AS variant,
    pi.quantity,
    pi.unit_price::numeric / 100.0 AS unit_price,
    pi.item_total::numeric / 100.0 AS line_total
   FROM pos_order_items pi
     JOIN pos_orders p ON p.id = pi.order_id
     JOIN ( VALUES
        ('outlet-con'::text, '89b19c9f-b1e0-42fe-a404-6d1a472e34c5'::text),
        ('outlet-sa'::text,  'b3b6299e-09dc-4f4a-80ef-bbc04316d324'::text),
        ('outlet-tam'::text, '5d1f2731-1985-4e54-a6df-3990e7d5c159'::text)
     ) m(slug, canonical_id) ON m.slug = p.outlet_id
  WHERE p.created_at >=
        CASE m.canonical_id
            WHEN '89b19c9f-b1e0-42fe-a404-6d1a472e34c5'::text THEN '2026-06-07 16:00:00+00'::timestamptz
            WHEN 'b3b6299e-09dc-4f4a-80ef-bbc04316d324'::text THEN '2026-06-14 16:00:00+00'::timestamptz
            WHEN '5d1f2731-1985-4e54-a6df-3990e7d5c159'::text THEN '2026-06-17 16:00:00+00'::timestamptz
            ELSE '1899-12-31 16:00:00+00'::timestamptz
        END
UNION ALL
 SELECT 'pickup'::text AS source,
    oi.order_id::text AS sale_id,
    ol.id AS outlet_id,
    ord.created_at AS txn_at,
    (ord.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'::text)::date AS biz_date,
    oi.product_name,
    oi.variant_name AS variant,
    oi.quantity,
    oi.unit_price::numeric / 100.0 AS unit_price,
    oi.item_total::numeric / 100.0 AS line_total
   FROM order_items oi
     JOIN orders ord ON ord.id = oi.order_id
     JOIN "Outlet" ol ON ol."pickupStoreId" = ord.store_id
  WHERE ord.status IN ('paid','preparing','ready','collected','completed');
