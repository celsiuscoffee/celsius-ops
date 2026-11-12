-- 112_evaluate_member_tier_prev_quarter.sql
--
-- STATUS: APPLIED to production 2026-11-12 (owner-approved). Verified: function
-- has v_prev_start, still SECURITY DEFINER, owner postgres, ACL unchanged.
--
-- Bug: evaluate_member_tier() re-qualifies a member on the CURRENT calendar
-- quarter's spend once their lock expires. The lock always expires exactly at
-- the quarter rollover, when current-quarter spend is ~RM0, so every earned
-- tier (Silver / Gold / Platinum) was demoted to Member on the member's first
-- visit of Q4 (from 2026-10-01). Gold-5% orders went 51/wk -> ~4/wk; 102
-- members whose Q3 spend qualifies them for a higher tier are now below it.
--
-- Fix: on lock expiry, qualify on GREATEST(previous-quarter spend,
-- current-quarter spend). The previous quarter is the one that just finished,
-- so a tier earned in Q3 is held through Q4 and must be re-earned during Q4
-- to carry into Q1. Mid-quarter upgrades are unchanged (current quarter only).
-- The return payload gains one additive key, `spend_prev_quarter`; all
-- existing keys and their meaning are unchanged.
--
-- Everything else is byte-for-byte the live definition as of 2026-11-11.

CREATE OR REPLACE FUNCTION public.evaluate_member_tier(p_member_id text, p_brand_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_quarter_start  timestamptz;
  v_quarter_end    timestamptz;
  v_prev_start     timestamptz;
  v_spend_quarter  numeric(10,2);
  v_spend_prev     numeric(10,2);
  v_visits_quarter integer;
  v_spend_lifetime numeric(10,2);
  v_phone          text;
  v_current_tier   record;
  v_current_id     text;
  v_locked_until   timestamptz;
  v_qualified_tier record;
  v_active_tier    record;
  v_next_tier      record;
  v_result         jsonb;
BEGIN
  -- Calendar-quarter window. Q1 = Jan-Mar, Q2 = Apr-Jun, etc.
  v_quarter_start := date_trunc('quarter', NOW());
  v_quarter_end   := v_quarter_start + interval '3 months';
  v_prev_start    := v_quarter_start - interval '3 months';

  -- Resolve the member's phone for the in-store (pos_orders) linkage —
  -- pos_orders has no member_id; it tags member sales by loyalty_phone.
  SELECT phone INTO v_phone FROM public.members WHERE id = p_member_id;

  -- Spend + visits from REAL paid orders (both channels), in ringgit net of
  -- SST. One scan covers the previous quarter and the current one.
  SELECT
    COALESCE(SUM(net_sen) FILTER (WHERE created_at >= v_quarter_start), 0)::numeric / 100.0,
    COALESCE(SUM(net_sen) FILTER (WHERE created_at <  v_quarter_start), 0)::numeric / 100.0,
    (COUNT(*) FILTER (WHERE created_at >= v_quarter_start))::integer
  INTO v_spend_quarter, v_spend_prev, v_visits_quarter
  FROM (
    SELECT GREATEST(o.total - COALESCE(o.sst_amount, 0), 0) AS net_sen, o.created_at
    FROM public.orders o
    WHERE o.loyalty_id = p_member_id
      AND o.status IN ('completed', 'paid', 'preparing', 'ready')
      AND o.created_at >= v_prev_start
    UNION ALL
    SELECT GREATEST(po.total - COALESCE(po.sst_amount, 0), 0) AS net_sen, po.created_at
    FROM public.pos_orders po
    WHERE v_phone IS NOT NULL
      AND po.loyalty_phone = v_phone
      AND po.status = 'completed'
      AND po.created_at >= v_prev_start
  ) spend_rows;

  -- Lifetime spend stays on member_brands.
  SELECT COALESCE(total_spent, 0), current_tier_id, tier_locked_until
  INTO v_spend_lifetime, v_current_id, v_locked_until
  FROM public.member_brands
  WHERE member_id = p_member_id AND brand_id = p_brand_id;

  SELECT * INTO v_current_tier
  FROM public.tiers WHERE id = v_current_id;

  -- Apply rules.
  IF v_current_tier.id IS NOT NULL AND v_current_tier.invitation_only THEN
    -- Admin-granted invitation tier — never auto-overwritten.
    v_active_tier := v_current_tier;

  ELSIF v_locked_until IS NULL OR v_locked_until <= NOW() THEN
    -- No active lock (new customer, or the previous quarter ended).
    -- Qualify on the better of the quarter that just finished and the
    -- current one: the lock expires exactly at the rollover, when
    -- current-quarter spend is ~0, so current-only would demote everyone.
    SELECT * INTO v_qualified_tier
    FROM public.tiers
    WHERE brand_id = p_brand_id
      AND is_active = true
      AND invitation_only = false
      AND min_spend <= GREATEST(v_spend_prev, v_spend_quarter)
    ORDER BY sort_order DESC
    LIMIT 1;

    -- Member tier (slug='bronze', discount 0%) is the fallback when no
    -- thresholds have been crossed.
    IF v_qualified_tier.id IS NULL THEN
      SELECT * INTO v_qualified_tier
      FROM public.tiers
      WHERE brand_id = p_brand_id AND slug = 'bronze' AND is_active = true
      LIMIT 1;
    END IF;
    v_active_tier := v_qualified_tier;

    UPDATE public.member_brands
    SET current_tier_id   = v_active_tier.id,
        tier_evaluated_at = NOW(),
        tier_locked_until = v_quarter_end
    WHERE member_id = p_member_id AND brand_id = p_brand_id;

  ELSE
    -- Lock active → only upgrades land mid-quarter, judged on THIS quarter's
    -- spend. A higher-tier qualification promotes immediately AND extends
    -- the lock to the current quarter end. Anything else keeps the existing
    -- tier (no demote until the quarter rolls over).
    SELECT * INTO v_qualified_tier
    FROM public.tiers
    WHERE brand_id = p_brand_id
      AND is_active = true
      AND invitation_only = false
      AND min_spend <= v_spend_quarter
    ORDER BY sort_order DESC
    LIMIT 1;

    IF v_qualified_tier.id IS NOT NULL
       AND v_qualified_tier.sort_order > COALESCE(v_current_tier.sort_order, 0) THEN
      v_active_tier := v_qualified_tier;
      UPDATE public.member_brands
      SET current_tier_id   = v_active_tier.id,
          tier_evaluated_at = NOW(),
          tier_locked_until = v_quarter_end
      WHERE member_id = p_member_id AND brand_id = p_brand_id;
    ELSE
      v_active_tier := v_current_tier;
    END IF;
  END IF;

  -- Next tier — the lowest sort_order > active that isn't invitation-only.
  SELECT * INTO v_next_tier
  FROM public.tiers
  WHERE brand_id = p_brand_id
    AND is_active = true
    AND invitation_only = false
    AND sort_order > COALESCE(v_active_tier.sort_order, 0)
  ORDER BY sort_order ASC
  LIMIT 1;

  v_result := jsonb_build_object(
    'tier_id',                v_active_tier.id,
    'tier_name',              v_active_tier.name,
    'tier_slug',              v_active_tier.slug,
    'tier_color',             v_active_tier.color,
    'tier_icon',              v_active_tier.icon,
    'tier_multiplier',        v_active_tier.multiplier,
    'tier_benefits',          v_active_tier.benefits,
    'tier_qualification',     v_active_tier.qualification_metric,
    'tier_discount_percent',  v_active_tier.discount_percent,
    'tier_stackable',         v_active_tier.stackable,
    'tier_invitation_only',   v_active_tier.invitation_only,
    'tier_locked_until',      v_quarter_end,
    'visits_this_period',     v_visits_quarter,
    'spend_this_period',      v_spend_quarter,
    'spend_prev_quarter',     v_spend_prev,
    'spend_lifetime',         v_spend_lifetime,
    'period_days',            EXTRACT(DAY FROM (v_quarter_end - v_quarter_start))::int,
    'quarter_start',          v_quarter_start,
    'quarter_end',            v_quarter_end,
    'next_tier_id',           v_next_tier.id,
    'next_tier_name',         v_next_tier.name,
    'next_tier_min_visits',   v_next_tier.min_visits,
    'next_tier_min_spend',    v_next_tier.min_spend,
    'next_tier_qualification', v_next_tier.qualification_metric,
    'visits_to_next_tier',    GREATEST(COALESCE(v_next_tier.min_visits, v_visits_quarter) - v_visits_quarter, 0),
    'spend_to_next_tier',     GREATEST(COALESCE(v_next_tier.min_spend, v_spend_quarter) - v_spend_quarter, 0)
  );

  RETURN v_result;
END;
$function$;
