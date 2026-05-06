-- ==========================================
-- Migration 014: Promotion Engine
-- StoreHub-equivalent promotion model so we can eventually
-- replace StoreHub's built-in promos.
-- Coexists with `rewards` (member-earnable) — promotions cover
-- auto-apply, code, tier-bound, and time-window discounts.
-- ==========================================

-- ─── Promotions table ───────────────────────────────

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,

  -- How the promotion is triggered
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'auto',          -- always-on for matching carts (e.g. Happy Hour)
    'code',          -- requires promo_code at checkout
    'tier_perk',     -- always-on for members of tier_id
    'reward_link'    -- driven by an issued_reward redemption
  )),
  promo_code TEXT,                 -- when trigger_type='code'
  tier_id TEXT REFERENCES tiers(id), -- when trigger_type='tier_perk'

  -- The discount itself (mirrors rewards table shape)
  discount_type TEXT NOT NULL CHECK (discount_type IN (
    'percentage_off',
    'fixed_amount_off',
    'free_item',
    'bogo',
    'combo_price',
    'override_price'
  )),
  discount_value DECIMAL(10,2),    -- % when percentage_off, RM when fixed_amount_off, etc.
  max_discount_value DECIMAL(10,2),-- cap on % discounts

  -- Targeting
  applicable_products TEXT[] DEFAULT '{}',
  applicable_categories TEXT[] DEFAULT '{}',
  applicable_tags TEXT[] DEFAULT '{}',
  outlet_ids TEXT[] DEFAULT '{}',    -- empty = all outlets

  -- BOGO
  bogo_buy_qty INTEGER,
  bogo_free_qty INTEGER,
  free_product_ids TEXT[] DEFAULT '{}',
  free_product_name TEXT,

  -- Combo / override
  combo_product_ids TEXT[] DEFAULT '{}',
  combo_price DECIMAL(10,2),
  override_price DECIMAL(10,2),

  -- Order-level conditions
  min_order_value DECIMAL(10,2),

  -- Time / date conditions
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  day_of_week INTEGER[] DEFAULT '{}',  -- 0..6, Sun..Sat; empty = any
  time_start TIME,                     -- happy-hour window start
  time_end TIME,                       -- happy-hour window end

  -- Limits
  max_uses_total INTEGER,            -- NULL = unlimited
  max_uses_per_member INTEGER,       -- per-member cap; NULL = unlimited
  uses_count INTEGER NOT NULL DEFAULT 0,

  -- Stacking
  stackable BOOLEAN NOT NULL DEFAULT false,

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0, -- higher wins when not stackable

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (brand_id, promo_code)
);

CREATE INDEX IF NOT EXISTS idx_promotions_brand_active ON promotions(brand_id, is_active);
CREATE INDEX IF NOT EXISTS idx_promotions_tier ON promotions(tier_id) WHERE tier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(brand_id, promo_code) WHERE promo_code IS NOT NULL;

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='promotions' AND policyname='Public read promotions') THEN
    CREATE POLICY "Public read promotions" ON promotions FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='promotions' AND policyname='Service full access promotions') THEN
    CREATE POLICY "Service full access promotions" ON promotions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── Application ledger ─────────────────────────────
-- Tracks which promotions were applied to which orders/transactions.
-- Used for max_uses_total / max_uses_per_member enforcement and reporting.

CREATE TABLE IF NOT EXISTS promotion_applications (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  outlet_id TEXT,  -- not FK; outlets is a view in this schema
  reference_id TEXT,                 -- order id or POS txn id
  discount_amount DECIMAL(10,2) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pa_promo ON promotion_applications(promotion_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_pa_member ON promotion_applications(member_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_pa_ref ON promotion_applications(brand_id, reference_id);

ALTER TABLE promotion_applications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='promotion_applications' AND policyname='Service full access promotion_applications') THEN
    CREATE POLICY "Service full access promotion_applications" ON promotion_applications FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── Atomic uses_count increment ────────────────────

CREATE OR REPLACE FUNCTION increment_promotion_uses(p_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE promotions SET uses_count = uses_count + 1 WHERE id = p_id;
END;
$$;

-- ─── Convert tier perks into promotions ─────────────
-- Gold size upgrade and Elite monthly drink already live as rewards
-- (issued via cron). Tier-perk *promotions* are different — they apply
-- to every transaction automatically once a member is in the tier.
-- Seed Gold and Elite "always-on" tier discounts so the engine has
-- something to demonstrate.

INSERT INTO promotions (
  id, brand_id, name, description,
  trigger_type, tier_id,
  discount_type, discount_value,
  is_active, priority
)
VALUES
  (
    'promo-gold-5pct', 'brand-celsius',
    'Gold member — 5% off',
    'Always-on 5% off every transaction for Gold-tier members.',
    'tier_perk', 'tier-celsius-gold',
    'percentage_off', 5.0,
    false, 10  -- seeded inactive; turn on from backoffice when ready
  ),
  (
    'promo-elite-10pct', 'brand-celsius',
    'Elite member — 10% off',
    'Always-on 10% off every transaction for Elite-tier members.',
    'tier_perk', 'tier-celsius-elite',
    'percentage_off', 10.0,
    false, 20
  )
ON CONFLICT (id) DO NOTHING;
