-- Server-side aggregate for the campaign scorecard's LIVE section. The JS version
-- fetched loop_assignments/issued_rewards/orders via .in(...), which Supabase caps
-- at 1000 rows — so the scorecard undercounted sent/vouchers/orders once volume
-- passed ~1000 (read 881 when 1904 had actually sent). This aggregates uncapped.
CREATE OR REPLACE FUNCTION loyalty_loops_live_rollup(p_since_days int DEFAULT NULL)
RETURNS TABLE(
  loop_key text, rounds int, in_flight int,
  sent bigint, vouchers bigint, redeemed bigint,
  orders bigint, revenue_rm numeric, next_results_at timestamptz
)
LANGUAGE sql STABLE
AS $$
  WITH r AS (
    SELECT lr.id, lr.loop_key, lr.status, lr.sent_at, lr.attribution_window_days
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
      UNION
      SELECT DISTINCT r.loop_key, p.id::text, p.total
      FROM r JOIN loop_assignments la ON la.round_id=r.id AND la.arm<>'holdout' AND la.sms_status='sent'
             JOIN pos_orders p ON p.customer_phone=la.phone AND p.created_at >= r.sent_at AND p.created_at <= r.sent_at + (r.attribution_window_days||' days')::interval
      WHERE r.status='sent'
    ) t GROUP BY t.loop_key
  )
  SELECT rnd.loop_key, rnd.rounds::int, rnd.in_flight::int,
    coalesce(asg.sent,0), coalesce(vou.vouchers,0), coalesce(vou.redeemed,0),
    coalesce(ord.orders,0), coalesce(ord.revenue_rm,0), rnd.next_results_at
  FROM rnd
  LEFT JOIN asg USING (loop_key)
  LEFT JOIN vou USING (loop_key)
  LEFT JOIN ord USING (loop_key);
$$;
