-- NIGHT REVIVAL — budget-capped restart of the round-gap objective.
-- (Applied live 2026-08-16.)
--
-- Round-gap was discontinued after 2,862 sends at -0.3pp. It targeted
-- "regulars who DON'T order in this day-part" -- a preference AGAINST that
-- time -- and asked them to reorganise their day for a free coffee. This
-- segment inverts the bet: everyone here has ALREADY chosen to come at night
-- at least once. Weekday nights are the real hole (15 orders/day vs 25 at
-- weekends, same outlets, same hours, ~RM17k/month of revenue in the gap), so
-- existing weekday-night regulars are excluded -- they need no nudge.
CREATE OR REPLACE FUNCTION loyalty_night_revival_segment(
  p_active_days int DEFAULT 60,
  p_max_wkday_night int DEFAULT 2,
  p_lookback_days int DEFAULT 90
)
RETURNS TABLE(member_id text, phone text, member_name text, night_visits int)
LANGUAGE sql STABLE AS $func$
  WITH night AS (
    SELECT customer_phone AS ph,
      count(*) FILTER (WHERE extract(hour FROM (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')) >= 19)::int AS night_visits,
      count(*) FILTER (WHERE extract(hour FROM (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')) >= 19
                         AND extract(dow FROM (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')) BETWEEN 1 AND 5)::int AS wkday_night,
      max(created_at) AS last_order
    FROM pos_orders
    WHERE created_at >= now() - (p_lookback_days || ' days')::interval
      AND total > 0 AND customer_phone IS NOT NULL AND btrim(customer_phone) <> ''
    GROUP BY 1
  )
  SELECT m.id::text, m.phone::text, coalesce(m.name,'')::text, n.night_visits
  FROM night n
  JOIN members m ON m.phone = n.ph
  JOIN member_brands mb ON mb.member_id = m.id AND mb.brand_id = 'brand-celsius'
  LEFT JOIN tiers t ON t.id = mb.current_tier_id
  WHERE n.night_visits >= 1
    AND n.wkday_night <= p_max_wkday_night
    AND n.last_order >= now() - (p_active_days || ' days')::interval
    AND coalesce(m.sms_opt_out,false) = false
    AND m.phone IS NOT NULL AND btrim(m.phone) <> ''
    AND m.phone NOT LIKE '+600%'
    AND (mb.current_tier_id IS NULL OR coalesce(t.stackable,true) = true)
  ORDER BY n.night_visits DESC, m.id;
$func$;

-- Night-occasion offer: free dessert gated at RM30 (night AOV RM29.84).
-- Deliberately not another free coffee -- nights already sell 62.6% coffee and
-- only 4.5% dessert/tea, so the missing reason at 9pm is one that isn't coffee.
INSERT INTO voucher_templates (
  id, brand_id, title, description, icon, category, discount_type,
  scope, target_ids, applicable_categories, min_order_value,
  validity_days, stacks_with_beans, stacks_with_other, is_active, auto_issue
)
SELECT 'a0000030-0000-4000-8000-000000000030', brand_id,
  'Free Dessert (spend RM30)', 'Any cake or pastry free with an RM30+ order',
  icon, category, discount_type, 'categories',
  ARRAY['cakes','cookies','croissant'], ARRAY['cakes','cookies','croissant'],
  30, validity_days, stacks_with_beans, stacks_with_other, true, false
FROM voucher_templates WHERE id = 'dfc9794d-0ead-443e-b854-a67cf3225791'
ON CONFLICT (id) DO NOTHING;
