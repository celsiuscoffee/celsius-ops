-- ==========================================
-- Migration 012: Tier Evaluation RPC + Post-Purchase Reward Type
-- ==========================================

-- ─── Add post_purchase reward type ──────────────────

ALTER TABLE rewards DROP CONSTRAINT IF EXISTS rewards_reward_type_check;
ALTER TABLE rewards ADD CONSTRAINT rewards_reward_type_check
  CHECK (reward_type IN ('standard', 'new_member', 'birthday', 'points_shop', 'post_purchase'));

-- For post_purchase rewards, discount_value stores the points multiplier bonus
-- (e.g. discount_value = 2.0 means 2× points on next visit)
-- NULL = no multiplier, just informational

-- ─── evaluate_member_tier RPC ───────────────────────
-- Counts earn transactions in the rolling window, finds the highest
-- qualifying tier, updates member_brands, and returns full tier status.
-- Called on every points award and on portal load.

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
  v_current_tier RECORD;
  v_next_tier RECORD;
  v_result JSONB;
BEGIN
  -- Use the Bronze tier's period_days as the brand default (all tiers share same window)
  SELECT COALESCE(MIN(period_days), 60) INTO v_period_days
  FROM tiers
  WHERE brand_id = p_brand_id AND is_active = true;

  -- Count earn transactions within the rolling window
  SELECT COUNT(*)::INTEGER INTO v_visits
  FROM point_transactions
  WHERE member_id = p_member_id
    AND brand_id = p_brand_id
    AND type = 'earn'
    AND created_at >= NOW() - (v_period_days || ' days')::INTERVAL;

  -- Find the highest tier the member qualifies for
  SELECT * INTO v_current_tier
  FROM tiers
  WHERE brand_id = p_brand_id
    AND is_active = true
    AND min_visits <= v_visits
  ORDER BY min_visits DESC
  LIMIT 1;

  -- Find the next tier up (first tier above current visits)
  SELECT * INTO v_next_tier
  FROM tiers
  WHERE brand_id = p_brand_id
    AND is_active = true
    AND min_visits > v_visits
  ORDER BY min_visits ASC
  LIMIT 1;

  -- Update member_brands with current tier
  IF v_current_tier.id IS NOT NULL THEN
    UPDATE member_brands
    SET
      current_tier_id = v_current_tier.id,
      tier_evaluated_at = NOW()
    WHERE member_id = p_member_id AND brand_id = p_brand_id;
  END IF;

  -- Build result
  v_result := jsonb_build_object(
    'tier_id',              v_current_tier.id,
    'tier_name',            v_current_tier.name,
    'tier_slug',            v_current_tier.slug,
    'tier_color',           v_current_tier.color,
    'tier_icon',            v_current_tier.icon,
    'tier_multiplier',      v_current_tier.multiplier,
    'tier_benefits',        v_current_tier.benefits,
    'visits_this_period',   v_visits,
    'period_days',          v_period_days,
    'next_tier_id',         v_next_tier.id,
    'next_tier_name',       v_next_tier.name,
    'next_tier_min_visits', v_next_tier.min_visits,
    'visits_to_next_tier',  GREATEST(COALESCE(v_next_tier.min_visits, v_visits) - v_visits, 0)
  );

  RETURN v_result;
END;
$$;

-- ─── Seed default post-purchase reward for Celsius ──
-- 2× points on the next visit, valid 7 days after issue.
-- The award endpoint auto-issues this after every earn transaction.

INSERT INTO rewards (
  id, brand_id, name, description,
  points_required, category,
  reward_type, auto_issue, validity_days,
  discount_type, discount_value,
  is_active, created_at, updated_at
)
VALUES (
  'reward-celsius-next-visit-2x',
  'brand-celsius',
  '2× Points — Next Visit',
  'Earn double points on your next visit. Valid for 7 days.',
  0, 'voucher',
  'post_purchase', true, 7,
  NULL, 2.0,
  true, NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name         = EXCLUDED.name,
  description  = EXCLUDED.description,
  auto_issue   = EXCLUDED.auto_issue,
  validity_days = EXCLUDED.validity_days,
  discount_value = EXCLUDED.discount_value,
  is_active    = EXCLUDED.is_active,
  updated_at   = NOW();
