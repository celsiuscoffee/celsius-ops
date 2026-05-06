-- ==========================================
-- Migration 017: distribution_methods on rewards
-- A reward can now be delivered multiple ways without duplicate rows.
-- ==========================================

ALTER TABLE rewards
  ADD COLUMN IF NOT EXISTS distribution_methods JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_rewards_distribution_methods
  ON rewards USING gin (distribution_methods);

-- Backfill from legacy reward_type + auto_issue + points_required.
UPDATE rewards SET distribution_methods = jsonb_build_array(
  CASE
    WHEN reward_type = 'birthday'      THEN jsonb_build_object('method', 'auto_birthday')
    WHEN reward_type = 'new_member'    THEN jsonb_build_object('method', 'auto_new_member')
    WHEN reward_type = 'post_purchase' THEN jsonb_build_object('method', 'auto_post_purchase')
    WHEN reward_type = 'tier_perk'     THEN jsonb_build_object('method', 'auto_tier')
    WHEN points_required > 0           THEN jsonb_build_object('method', 'points_shop', 'points_cost', points_required)
    ELSE                                    jsonb_build_object('method', 'points_shop', 'points_cost', points_required)
  END
)
WHERE distribution_methods = '[]'::jsonb;
