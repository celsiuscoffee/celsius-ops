-- Round-gap audience: home-outlet regulars (from order history, both ID schemes)
-- who DON'T habitually order at the target round — i.e. incremental for that
-- day-part. Reachable + active. Uncapped (server-side). Drives the round-gap loop.
CREATE OR REPLACE FUNCTION loyalty_round_gap_segment(
  p_outlet text, p_round_start int, p_round_end int,
  p_active_days int DEFAULT 45, p_history_days int DEFAULT 90, p_max_round_orders int DEFAULT 1
)
RETURNS TABLE(member_id text, phone text, member_name text)
LANGUAGE sql STABLE AS $$
  WITH ids AS (
    SELECT CASE p_outlet
      WHEN 'conezion'  THEN ARRAY['conezion','outlet-con']
      WHEN 'shah-alam' THEN ARRAY['shah-alam','outlet-sa']
      WHEN 'tamarind'  THEN ARRAY['tamarind','outlet-tam']
      ELSE ARRAY[p_outlet] END AS arr
  ),
  ord AS (
    SELECT po.customer_phone AS phone, po.outlet_id AS outlet,
      extract(hour from (po.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS h, po.created_at AS ts
    FROM pos_orders po WHERE po.customer_phone IS NOT NULL AND po.created_at >= now() - (p_history_days||' days')::interval
    UNION ALL
    SELECT o.customer_phone, o.store_id,
      extract(hour from (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int, o.created_at
    FROM orders o WHERE o.customer_phone IS NOT NULL AND o.created_at >= now() - (p_history_days||' days')::interval
  ),
  at_outlet AS (
    SELECT o.phone, count(*) AS outlet_orders,
      count(*) FILTER (WHERE o.h >= p_round_start AND o.h < p_round_end) AS round_orders
    FROM ord o CROSS JOIN ids WHERE o.outlet = ANY(ids.arr) GROUP BY o.phone
  ),
  recency AS ( SELECT phone, max(ts) AS last_any FROM ord GROUP BY phone )
  SELECT DISTINCT m.id::text, m.phone::text, coalesce(m.name,'')::text
  FROM at_outlet a
  JOIN recency r ON r.phone = a.phone
  JOIN members m ON m.phone = a.phone
  JOIN member_brands mb ON mb.member_id = m.id AND mb.brand_id = 'brand-celsius'
  WHERE a.outlet_orders >= 2 AND a.round_orders <= p_max_round_orders
    AND r.last_any >= now() - (p_active_days||' days')::interval
    AND coalesce(m.sms_opt_out,false) = false AND m.phone IS NOT NULL AND btrim(m.phone) <> '';
$$;
