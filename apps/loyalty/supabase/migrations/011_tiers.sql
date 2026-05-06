-- ==========================================
-- Migration 011: Tier System
-- ZUS-style Bronze → Silver → Gold → Elite
-- Tiers based on visits in a rolling 60-day window
-- ==========================================

-- ─── Tiers table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS tiers (
  id TEXT PRIMARY KEY,
  brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  min_visits INTEGER NOT NULL DEFAULT 0,    -- visits in rolling period to qualify
  period_days INTEGER NOT NULL DEFAULT 60,  -- rolling window length in days
  color TEXT DEFAULT '#CD7F32',             -- hex color for UI badge
  icon TEXT DEFAULT '☕',                   -- emoji shown in badge
  benefits JSONB DEFAULT '[]',              -- list of benefit strings shown to member
  multiplier DECIMAL(4,2) DEFAULT 1.00,     -- points multiplier at this tier
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(brand_id, slug)
);

-- ─── Add tier tracking to member_brands ─────────────

ALTER TABLE member_brands ADD COLUMN IF NOT EXISTS current_tier_id TEXT REFERENCES tiers(id);
ALTER TABLE member_brands ADD COLUMN IF NOT EXISTS tier_evaluated_at TIMESTAMPTZ;

-- ─── RLS ────────────────────────────────────────────

ALTER TABLE tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read tiers" ON tiers FOR SELECT USING (true);
CREATE POLICY "Service full access tiers" ON tiers FOR ALL USING (true) WITH CHECK (true);

-- ─── Index ──────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tiers_brand ON tiers(brand_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_member_brands_tier ON member_brands(current_tier_id);

-- ─── Seed Celsius Coffee tiers ──────────────────────
-- Rolling 60-day window; thresholds calibrated for a coffee habit:
--   Bronze  : default (everyone starts here)
--   Silver  : ~1 visit/week   (8 visits in 60 days)
--   Gold    : ~3 visits/week  (20 visits in 60 days)
--   Elite   : ~5+ visits/week (40 visits in 60 days, near-daily)

INSERT INTO tiers (id, brand_id, name, slug, min_visits, period_days, color, icon, benefits, multiplier, sort_order)
VALUES
  (
    'tier-celsius-bronze', 'brand-celsius',
    'Bronze', 'bronze', 0, 60,
    '#92400e', '☕',
    '["Earn 1 point per RM1 spent", "Birthday reward", "Member-only promotions"]',
    1.00, 1
  ),
  (
    'tier-celsius-silver', 'brand-celsius',
    'Silver', 'silver', 8, 60,
    '#6b7280', '⭐',
    '["1.25× points on every purchase", "Everything in Bronze", "Early access to new drinks"]',
    1.25, 2
  ),
  (
    'tier-celsius-gold', 'brand-celsius',
    'Gold', 'gold', 20, 60,
    '#b45309', '🌟',
    '["1.5× points on every purchase", "Everything in Silver", "Free size upgrade once a month"]',
    1.50, 3
  ),
  (
    'tier-celsius-elite', 'brand-celsius',
    'Elite', 'elite', 40, 60,
    '#4f46e5', '👑',
    '["2× points on every purchase", "Everything in Gold", "Exclusive Elite events", "Complimentary monthly drink"]',
    2.00, 4
  )
ON CONFLICT (brand_id, slug) DO NOTHING;
