-- Live rollup v2: for round_gap rounds, only count orders placed AT THE TARGET
-- OUTLET during the TARGET ROUND (day-part) — the "intended gap" — matching
-- measureRound. Other loops (winback/welcome/birthday/reward_expiring) aren't
-- round-specific, so they still count any order in the attribution window.
-- Fixes the live scorecard crediting an out-of-gap order to round_gap (e.g. a
-- 5:24pm order counted against an 8-10am breakfast campaign).
CREATE OR REPLACE FUNCTION public.loyalty_loops_live_rollup(p_since_days integer DEFAULT NULL::integer)
RETURNS TABLE(loop_key text, rounds integer, in_flight integer, sent bigint, vouchers bigint, redeemed bigint, orders bigint, revenue_rm numeric, next_results_at timestamp with time zone)
LANGUAGE sql STABLE AS $function$
  WITH r AS (
    SELECT lr.id, lr.loop_key, lr.status, lr.sent_at, lr.attribution_window_days,
      (lr.meta->>'round_start')::int AS rs, (lr.meta->>'round_end')::int AS re,
      CASE lr.meta->>'outlet'
        WHEN 'conezion' THEN ARRAY['conezion','outlet-con']
        WHEN 'shah-alam' THEN ARRAY['shah-alam','outlet-sa']
        WHEN 'tamarind' THEN ARRAY['tamarind','outlet-tam']
        ELSE ARRAY[lr.meta->>'outlet'] END AS rg_outlets
    FROM loop_rounds lr
    WHERE lr.status IN ('sent','measured')
      AND (p_since_days IS NULL OR lr.sent_at >= now() - (p_since_days || ' days')::interval)
  ),
  asg AS (
    SELECT r.loop_key, count(*) FILTER (WHERE la.sms_status='sent') AS sent
    FROM r JOIN loop_assignments la ON la.round_id = r.id GROUP BY r.loop_key
  ),
  vou AS (
    SELECT r.loop_key, count(*) AS vouchers,
           count(*) FILTER (WHERE ir.redeemed_at IS NOT NULL OR ir.status = 'redeemed') AS redeemed
    FROM r JOIN issued_rewards ir ON ir.source_ref_id = r.id GROUP BY r.loop_key
  ),
  rnd AS (
    SELECT loop_key, count(*) AS rounds,
           count(*) FILTER (WHERE status='sent') AS in_flight,
           min(sent_at + (attribution_window_days || ' days')::interval) FILTER (WHERE status='sent') AS next_results_at
    FROM r GROUP BY loop_key
  ),
  ord AS (
    SELECT t.loop_key, count(*) AS orders, coalesce(sum(t.total),0)/100.0 AS revenue_rm
    FROM (
      SELECT DISTINCT r.loop_key, o.id::text AS oid, o.total
      FROM r JOIN loop_assignments la ON la.round_id=r.id AND la.arm<>'holdout' AND la.sms_status='sent'
             JOIN orders o ON o.customer_phone=la.phone AND o.created_at >= r.sent_at AND o.created_at <= r.sent_at + (r.attribution_window_days||' days')::interval
      WHERE r.status='sent'
        AND (r.loop_key <> 'round_gap' OR (
          o.store_id = ANY(r.rg_outlets)
          AND extract(hour FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int >= r.rs
          AND extract(hour FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int <  r.re ))
      UNION
      SELECT DISTINCT r.loop_key, p.id::text, p.total
      FROM r JOIN loop_assignments la ON la.round_id=r.id AND la.arm<>'holdout' AND la.sms_status='sent'
             JOIN pos_orders p ON p.customer_phone=la.phone AND p.created_at >= r.sent_at AND p.created_at <= r.sent_at + (r.attribution_window_days||' days')::interval
      WHERE r.status='sent'
        AND (r.loop_key <> 'round_gap' OR (
          p.outlet_id = ANY(r.rg_outlets)
          AND extract(hour FROM (p.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int >= r.rs
          AND extract(hour FROM (p.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int <  r.re ))
    ) t GROUP BY t.loop_key
  )
  SELECT rnd.loop_key, rnd.rounds::int, rnd.in_flight::int,
    coalesce(asg.sent,0), coalesce(vou.vouchers,0), coalesce(vou.redeemed,0),
    coalesce(ord.orders,0), coalesce(ord.revenue_rm,0), rnd.next_results_at
  FROM rnd
  LEFT JOIN asg USING (loop_key)
  LEFT JOIN vou USING (loop_key)
  LEFT JOIN ord USING (loop_key);
$function$;
