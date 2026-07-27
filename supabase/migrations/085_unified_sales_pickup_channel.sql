-- Adds the pickup app (public.orders) as a fifth branch of unified_sales,
-- closing the ~RM40k/month gap found by the finance-warehouse agent
-- (2026-07-17): the view billed as "the only sales truth" excluded pickup
-- entirely. Owner-approved in session ("Yes, add channel").
--
-- Conventions preserved:
--   - money in orders is stored in SEN -> divide by 100
--   - biz_date = MYT calendar day of created_at
--   - the paid-status filter is BAKED IN (paid/preparing/ready/collected/
--     completed = PICKUP_PAID_STATUSES, revenue recognised at payment), so
--     the standard revenue convention (NOT is_refund AND status <>
--     'paymentCancelled') keeps working unchanged for consumers.
--   - outlet mapping via "Outlet"."pickupStoreId" = orders.store_id
--     (verified 2026-07-17: Putrajaya/Shah Alam/Tamarind mapped, zero
--     unmapped paid orders; Conezion has no pickupStoreId yet and joins in
--     automatically once set).
-- The backoffice dashboard lib (api/sales/_lib/unified-sales.ts) reads raw
-- tables, NOT this view, so no double-count there. unified_sale_items does
-- NOT yet carry pickup item lines (follow-up).
--
-- Applied 2026-07-17 via Supabase MCP (apply_migration:
-- unified_sales_pickup_channel) in-session on owner approval.

CREATE OR REPLACE VIEW unified_sales AS
 SELECT 'hubbo'::text AS source,
    h.id::text AS sale_id,
    h.outlet_id,
    o.name AS outlet_name,
    h.transaction_time AS txn_at,
    (h.transaction_time AT TIME ZONE 'Asia/Kuala_Lumpur'::text)::date AS biz_date,
    h.invoice_no AS order_ref,
    h.item_count,
    h.gross,
    h.discount,
    h.sst,
    h.nett,
    h.tender,
    'counter'::text AS channel,
    h.status,
    h.is_refund
   FROM hubbo_sales h
     JOIN "Outlet" o ON o.id = h.outlet_id
  WHERE h.transaction_time <
        CASE h.outlet_id
            WHEN '89b19c9f-b1e0-42fe-a404-6d1a472e34c5'::text THEN '2026-01-02 16:00:00+00'::timestamptz
            WHEN 'b3b6299e-09dc-4f4a-80ef-bbc04316d324'::text THEN '2026-01-20 16:00:00+00'::timestamptz
            ELSE '2099-12-31 16:00:00+00'::timestamptz
        END
UNION ALL
 SELECT 'storehub'::text AS source,
    s.id::text AS sale_id,
    s.outlet_id,
    o.name AS outlet_name,
    s.transaction_time AS txn_at,
    (s.transaction_time AT TIME ZONE 'Asia/Kuala_Lumpur'::text)::date AS biz_date,
    s.ref_id AS order_ref,
    s.item_count,
    s.sub_total AS gross,
    NULL::numeric AS discount,
    NULL::numeric AS sst,
    s.total AS nett,
    NULL::text AS tender,
    COALESCE(s.channel_class, s.channel) AS channel,
    s.status,
    COALESCE(s.is_cancelled, false) OR lower(COALESCE(s.transaction_type, ''::text)) LIKE '%refund%' AS is_refund
   FROM storehub_sales s
     JOIN "Outlet" o ON o.id = s.outlet_id
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
    p.id AS sale_id,
    m.canonical_id AS outlet_id,
    o.name AS outlet_name,
    p.created_at AS txn_at,
    (p.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'::text)::date AS biz_date,
    p.order_number AS order_ref,
    ( SELECT COALESCE(sum(i.quantity), 0::bigint)::integer
           FROM pos_order_items i
          WHERE i.order_id = p.id) AS item_count,
    p.subtotal::numeric / 100.0 AS gross,
    (COALESCE(p.discount_amount, 0) + COALESCE(p.promo_discount, 0) + COALESCE(p.reward_discount_amount, 0))::numeric / 100.0 AS discount,
    p.sst_amount::numeric / 100.0 AS sst,
    p.total::numeric / 100.0 AS nett,
    ( SELECT string_agg(DISTINCT pay.payment_method, '+'::text)
           FROM pos_order_payments pay
          WHERE pay.order_id = p.id) AS tender,
    COALESCE(p.source, p.order_type) AS channel,
    p.status,
    p.refund_of_order_id IS NOT NULL AS is_refund
   FROM pos_orders p
     JOIN ( VALUES ('outlet-con'::text,'89b19c9f-b1e0-42fe-a404-6d1a472e34c5'::text), ('outlet-sa'::text,'b3b6299e-09dc-4f4a-80ef-bbc04316d324'::text), ('outlet-tam'::text,'5d1f2731-1985-4e54-a6df-3990e7d5c159'::text)) m(slug, canonical_id) ON m.slug = p.outlet_id
     JOIN "Outlet" o ON o.id = m.canonical_id
  WHERE p.created_at >=
        CASE m.canonical_id
            WHEN '89b19c9f-b1e0-42fe-a404-6d1a472e34c5'::text THEN '2026-06-07 16:00:00+00'::timestamptz
            WHEN 'b3b6299e-09dc-4f4a-80ef-bbc04316d324'::text THEN '2026-06-14 16:00:00+00'::timestamptz
            WHEN '5d1f2731-1985-4e54-a6df-3990e7d5c159'::text THEN '2026-06-17 16:00:00+00'::timestamptz
            ELSE '1899-12-31 16:00:00+00'::timestamptz
        END
UNION ALL
 SELECT 'consignment'::text AS source,
    cs.id AS sale_id,
    cs.outlet_id,
    o.name AS outlet_name,
    ((cs.biz_date + '12:00:00'::time) AT TIME ZONE 'Asia/Kuala_Lumpur'::text) AS txn_at,
    cs.biz_date,
    cs.source_file AS order_ref,
    cs.item_count,
    cs.gross,
    0::numeric AS discount,
    0::numeric AS sst,
    cs.gross AS nett,
    NULL::text AS tender,
    'counter'::text AS channel,
    'SUCCESS'::text AS status,
    false AS is_refund
   FROM consignment_sales cs
     JOIN "Outlet" o ON o.id = cs.outlet_id
UNION ALL
 SELECT 'pickup'::text AS source,
    ord.id::text AS sale_id,
    ol.id AS outlet_id,
    ol.name AS outlet_name,
    ord.created_at AS txn_at,
    (ord.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'::text)::date AS biz_date,
    ord.order_number AS order_ref,
    ( SELECT COALESCE(sum(oi.quantity), 0::bigint)::integer
           FROM order_items oi
          WHERE oi.order_id = ord.id) AS item_count,
    ord.subtotal::numeric / 100.0 AS gross,
    (COALESCE(ord.discount_amount, 0) + COALESCE(ord.reward_discount_amount, 0))::numeric / 100.0 AS discount,
    ord.sst_amount::numeric / 100.0 AS sst,
    ord.total::numeric / 100.0 AS nett,
    ord.payment_method AS tender,
    'pickup'::text AS channel,
    ord.status,
    false AS is_refund
   FROM orders ord
     JOIN "Outlet" ol ON ol."pickupStoreId" = ord.store_id
  WHERE ord.status IN ('paid','preparing','ready','collected','completed');
