-- ==========================================
-- Migration 013: Tier Benefits Engine
-- Structured benefit rules + idempotent grant ledger.
-- ==========================================

-- ─── Add structured rules to tiers ──────────────────
-- benefit_rules is the source of truth for backend logic.
-- benefits (existing column) stays as the display string array.

ALTER TABLE tiers ADD COLUMN IF NOT EXISTS benefit_rules JSONB DEFAULT '[]';

-- ─── Grants ledger ──────────────────────────────────
-- One row per benefit issued to a member in a given period.
-- The UNIQUE constraint makes the cron handlers idempotent — running
-- the monthly job twice on the same day is a no-op.

CREATE TABLE IF NOT EXISTS tier_benefit_grants (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  tier_id TEXT REFERENCES tiers(id),
  benefit_type TEXT NOT NULL,             -- 'birthday_reward' | 'monthly_perk'
  period_key TEXT NOT NULL,               -- '2026' for birthday, '2026-05' for monthly
  issued_reward_id TEXT REFERENCES issued_rewards(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, benefit_type, period_key)
);

ALTER TABLE tier_benefit_grants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tier_benefit_grants' AND policyname='Service full access tier_benefit_grants') THEN
    CREATE POLICY "Service full access tier_benefit_grants" ON tier_benefit_grants FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tbg_member ON tier_benefit_grants(member_id, benefit_type);
CREATE INDEX IF NOT EXISTS idx_tbg_brand ON tier_benefit_grants(brand_id, granted_at DESC);

-- ─── Seed perk rewards for Celsius ──────────────────
-- These are the rewards that benefit_rules point at.

INSERT INTO rewards (
  id, brand_id, name, description,
  points_required, category,
  reward_type, auto_issue, validity_days,
  discount_type, discount_value,
  is_active, created_at, updated_at
)
VALUES
  (
    'reward-celsius-birthday-drink', 'brand-celsius',
    'Birthday Drink', 'A complimentary drink for your birthday. Valid 30 days.',
    0, 'drink', 'birthday', false, 30,
    NULL, NULL, true, NOW(), NOW()
  ),
  (
    'reward-celsius-gold-size-upgrade', 'brand-celsius',
    'Free Size Upgrade', 'Upgrade any drink one size free. Valid 30 days.',
    0, 'drink', 'standard', false, 30,
    NULL, NULL, true, NOW(), NOW()
  ),
  (
    'reward-celsius-elite-monthly-drink', 'brand-celsius',
    'Elite Monthly Drink', 'Complimentary drink as an Elite member. Valid 30 days.',
    0, 'drink', 'standard', false, 30,
    NULL, NULL, true, NOW(), NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  name         = EXCLUDED.name,
  description  = EXCLUDED.description,
  reward_type  = EXCLUDED.reward_type,
  validity_days = EXCLUDED.validity_days,
  is_active    = EXCLUDED.is_active,
  updated_at   = NOW();

-- ─── Seed benefit rules per tier ────────────────────

UPDATE tiers SET benefit_rules = '[
  { "type": "points_multiplier", "value": 1.0 },
  { "type": "birthday_reward", "reward_id": "reward-celsius-birthday-drink" }
]'::jsonb WHERE id = 'tier-celsius-bronze';

UPDATE tiers SET benefit_rules = '[
  { "type": "points_multiplier", "value": 1.25 },
  { "type": "birthday_reward", "reward_id": "reward-celsius-birthday-drink" },
  { "type": "early_access", "label": "Early access to new drinks" }
]'::jsonb WHERE id = 'tier-celsius-silver';

UPDATE tiers SET benefit_rules = '[
  { "type": "points_multiplier", "value": 1.5 },
  { "type": "birthday_reward", "reward_id": "reward-celsius-birthday-drink" },
  { "type": "early_access", "label": "Early access to new drinks" },
  { "type": "monthly_perk", "reward_id": "reward-celsius-gold-size-upgrade", "label": "Free size upgrade once a month" }
]'::jsonb WHERE id = 'tier-celsius-gold';

UPDATE tiers SET benefit_rules = '[
  { "type": "points_multiplier", "value": 2.0 },
  { "type": "birthday_reward", "reward_id": "reward-celsius-birthday-drink" },
  { "type": "early_access", "label": "Early access to new drinks" },
  { "type": "monthly_perk", "reward_id": "reward-celsius-elite-monthly-drink", "label": "Complimentary monthly drink" },
  { "type": "exclusive_event", "label": "Exclusive Elite events" }
]'::jsonb WHERE id = 'tier-celsius-elite';
