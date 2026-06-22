-- Round-gap segment v3: union the behavioral round-skippers with the imported
-- StoreHub base for the outlet that has never ordered native (the dormant ~15k).
-- This points the dormant base at the weak rounds to FILL them. Adds source +
-- priority (skippers first, then StoreHub-tier imports, then points, then rest)
-- and de-dupes so nobody is messaged twice (skippers: 14-day cooldown; imports:
-- one-shot — never re-message a cold import via round-gap).
DROP FUNCTION IF EXISTS loyalty_round_gap_segment(text, int, int, int, int, int);

CREATE FUNCTION loyalty_round_gap_segment(
  p_outlet text, p_round_start int, p_round_end int,
  p_active_days int DEFAULT 45, p_history_days int DEFAULT 90, p_max_round_orders int DEFAULT 1,
  p_cooldown_days int DEFAULT 14
)
RETURNS TABLE(member_id text, phone text, member_name text, source text, priority int)
LANGUAGE sql STABLE AS $function$
  WITH ids AS (
    SELECT CASE p_outlet
      WHEN 'conezion'  THEN ARRAY['conezion','outlet-con']
      WHEN 'shah-alam' THEN ARRAY['shah-alam','outlet-sa']
      WHEN 'tamarind'  THEN ARRAY['tamarind','outlet-tam']
      ELSE ARRAY[p_outlet] END AS arr
  ),
  outlet_tag AS (
    SELECT CASE p_outlet
      WHEN 'conezion'  THEN 'Putrajaya'
      WHEN 'shah-alam' THEN 'Shah Alam'
      WHEN 'tamarind'  THEN 'Tamarind'
      ELSE p_outlet END AS tag
  ),
  recent AS (   -- messaged by round-gap within cooldown (skipper suppression)
    SELECT DISTINCT la.member_id::text AS member_id
    FROM loop_assignments la JOIN loop_rounds lr ON lr.id = la.round_id
    WHERE lr.loop_key = 'round_gap'
      AND coalesce(lr.sent_at, lr.prepared_at) >= now() - (p_cooldown_days||' days')::interval
  ),
  ever AS (     -- ever messaged by round-gap (import one-shot suppression)
    SELECT DISTINCT la.member_id::text AS member_id
    FROM loop_assignments la JOIN loop_rounds lr ON lr.id = la.round_id
    WHERE lr.loop_key = 'round_gap'
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
    FROM ord o CROSS JOIN ids WHERE o.outlet = ANY(ids.arr)
    GROUP BY o.phone
  ),
  recency AS ( SELECT phone, max(ts) AS last_any FROM ord GROUP BY phone ),
  skippers AS (   -- (A) outlet regulars who skip this round
    SELECT DISTINCT m.id::text AS member_id, m.phone::text AS phone, coalesce(m.name,'')::text AS member_name,
      'skipper'::text AS source, 1 AS priority
    FROM at_outlet a
    JOIN recency r ON r.phone = a.phone
    JOIN members m ON m.phone = a.phone
    JOIN member_brands mb ON mb.member_id = m.id AND mb.brand_id = 'brand-celsius'
    WHERE a.outlet_orders >= 2 AND a.round_orders <= p_max_round_orders
      AND r.last_any >= now() - (p_active_days||' days')::interval
      AND coalesce(m.sms_opt_out,false) = false AND m.phone IS NOT NULL AND btrim(m.phone) <> ''
      AND m.id::text NOT IN (SELECT member_id FROM recent)
  ),
  imports AS (   -- (B) imported StoreHub base for this outlet, never ordered native
    SELECT m.id::text AS member_id, m.phone::text AS phone, coalesce(m.name,'')::text AS member_name,
      'import'::text AS source,
      CASE WHEN 'SH_Tier_1' = ANY(m.tags) THEN 2
           WHEN coalesce(mb.points_balance,0) > 0 THEN 3 ELSE 4 END AS priority
    FROM members m
    JOIN member_brands mb ON mb.member_id = m.id AND mb.brand_id = 'brand-celsius'
    CROSS JOIN outlet_tag ot
    WHERE (mb.total_visits = 0 OR mb.last_visit_at IS NULL)
      AND ot.tag = ANY(m.tags)
      AND coalesce(m.sms_opt_out,false) = false AND m.phone IS NOT NULL AND btrim(m.phone) <> ''
      AND m.id::text NOT IN (SELECT member_id FROM ever)
  )
  SELECT u.member_id, u.phone, u.member_name, u.source, u.priority
  FROM (SELECT * FROM skippers UNION SELECT * FROM imports) u
  ORDER BY u.priority, u.member_id;
$function$;
