-- ==========================================
-- Migration 015: StoreHub-style tier qualification
-- StoreHub qualifies VIP/membership levels by spend (lifetime or
-- rolling), often with visit count as an alternative path.
-- Extend tiers with both metrics + a "either qualifies" rule.
-- ==========================================

ALTER TABLE tiers ADD COLUMN IF NOT EXISTS min_spend DECIMAL(10,2) DEFAULT 0;

-- 'visits'         — visits in rolling period (current behaviour)
-- 'spend'          — RM spent in rolling period
-- 'spend_lifetime' — RM spent ever
-- 'either'         — qualify if EITHER min_visits OR min_spend hit
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS qualification_metric TEXT
  NOT NULL DEFAULT 'visits'
  CHECK (qualification_metric IN ('visits', 'spend', 'spend_lifetime', 'either'));

-- Default Celsius tiers to "either" so members can climb via spend OR
-- visits. Spend thresholds calibrated for ~RM12 average ticket:
--   Bronze : 0
--   Silver : RM 96   (~8 visits × RM12)
--   Gold   : RM 240  (~20 visits × RM12)
--   Elite  : RM 480  (~40 visits × RM12)
UPDATE tiers SET qualification_metric = 'either', min_spend = 0   WHERE id = 'tier-celsius-bronze';
UPDATE tiers SET qualification_metric = 'either', min_spend = 96  WHERE id = 'tier-celsius-silver';
UPDATE tiers SET qualification_metric = 'either', min_spend = 240 WHERE id = 'tier-celsius-gold';
UPDATE tiers SET qualification_metric = 'either', min_spend = 480 WHERE id = 'tier-celsius-elite';

-- ─── Replace evaluate_member_tier RPC ──────────────
-- Now considers both visits and spend in the rolling window, picks
-- the highest tier that qualifies under its declared metric.

CREATE OR REPLACE FUNCTION evaluate_member_tier(
  p_member_id TEXT,
  p_brand_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_days INTEGER;
  v_visits INTEGER;
  v_spend_period DECIMAL(10,2);
  v_spend_lifetime DECIMAL(10,2);
  v_current_tier RECORD;
  v_next_tier RECORD;
  v_result JSONB;
BEGIN
  SELECT COALESCE(MIN(period_days), 60) INTO v_period_days
  FROM tiers
  WHERE brand_id = p_brand_id AND is_active = true;

  -- Visit count in rolling period
  SELECT COUNT(*)::INTEGER INTO v_visits
  FROM point_transactions
  WHERE member_id = p_member_id
    AND brand_id = p_brand_id
    AND type = 'earn'
    AND created_at >= NOW() - (v_period_days || ' days')::INTERVAL;

  -- Spend in rolling period (member_brands.total_spent is lifetime — we
  -- can't easily decompose by period, so pull from point_transactions).
  -- Approximation: each earn transaction's `points` ≈ RM spent at 1×.
  -- For the spend metric we instead read total_spent from member_brands.
  SELECT
    COALESCE(SUM(points), 0)::DECIMAL(10,2)
  INTO v_spend_period
  FROM point_transactions
  WHERE member_id = p_member_id
    AND brand_id = p_brand_id
    AND type = 'earn'
    AND created_at >= NOW() - (v_period_days || ' days')::INTERVAL;

  SELECT COALESCE(total_spent, 0) INTO v_spend_lifetime
  FROM member_brands
  WHERE member_id = p_member_id AND brand_id = p_brand_id;

  -- Find the highest tier the member qualifies for under its metric.
  -- Iterating in DESC order of (sort_order) lets us pick the top tier
  -- whose qualification predicate is satisfied.
  SELECT * INTO v_current_tier
  FROM tiers
  WHERE brand_id = p_brand_id
    AND is_active = true
    AND (
      (qualification_metric = 'visits'         AND min_visits <= v_visits) OR
      (qualification_metric = 'spend'          AND min_spend  <= v_spend_period) OR
      (qualification_metric = 'spend_lifetime' AND min_spend  <= v_spend_lifetime) OR
      (qualification_metric = 'either'         AND (min_visits <= v_visits OR min_spend <= v_spend_period))
    )
  ORDER BY sort_order DESC
  LIMIT 1;

  -- Next tier up (first tier that doesn't yet qualify)
  SELECT * INTO v_next_tier
  FROM tiers
  WHERE brand_id = p_brand_id
    AND is_active = true
    AND sort_order > COALESCE(v_current_tier.sort_order, 0)
  ORDER BY sort_order ASC
  LIMIT 1;

  IF v_current_tier.id IS NOT NULL THEN
    UPDATE member_brands
    SET
      current_tier_id = v_current_tier.id,
      tier_evaluated_at = NOW()
    WHERE member_id = p_member_id AND brand_id = p_brand_id;
  END IF;

  v_result := jsonb_build_object(
    'tier_id',                v_current_tier.id,
    'tier_name',              v_current_tier.name,
    'tier_slug',              v_current_tier.slug,
    'tier_color',             v_current_tier.color,
    'tier_icon',              v_current_tier.icon,
    'tier_multiplier',        v_current_tier.multiplier,
    'tier_benefits',          v_current_tier.benefits,
    'tier_qualification',     v_current_tier.qualification_metric,
    'visits_this_period',     v_visits,
    'spend_this_period',      v_spend_period,
    'spend_lifetime',         v_spend_lifetime,
    'period_days',            v_period_days,
    'next_tier_id',           v_next_tier.id,
    'next_tier_name',         v_next_tier.name,
    'next_tier_min_visits',   v_next_tier.min_visits,
    'next_tier_min_spend',    v_next_tier.min_spend,
    'next_tier_qualification',v_next_tier.qualification_metric,
    'visits_to_next_tier',    GREATEST(COALESCE(v_next_tier.min_visits, v_visits) - v_visits, 0),
    'spend_to_next_tier',     GREATEST(COALESCE(v_next_tier.min_spend, v_spend_period) - v_spend_period, 0)
  );

  RETURN v_result;
END;
$$;
