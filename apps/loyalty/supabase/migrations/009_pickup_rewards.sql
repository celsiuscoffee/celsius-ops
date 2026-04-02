-- ==========================================
-- Migration 009: Pickup-ready reward structure
-- Adds discount mechanics so pickup apps can
-- auto-apply rewards at checkout
-- ==========================================

-- ─── Rewards: discount mechanics ────────────────────

-- What type of discount this reward gives
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS discount_type TEXT;
-- 'fixed_amount' | 'percentage' | 'free_item' | 'bogo' | NULL (legacy/manual)

-- Numeric value: 5.00 for RM5 off, 20 for 20% off, NULL for free_item/bogo
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS discount_value DECIMAL;

-- Cap for percentage discounts (e.g. 20% off max RM15)
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS max_discount_value DECIMAL;

-- Minimum cart total required to use this reward
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS min_order_value DECIMAL;

-- ─── Rewards: product targeting ─────────────────────

-- Specific product IDs this reward applies to (NULL = all products)
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS applicable_products TEXT[];

-- Category slugs from pickup app catalog (NULL = all categories)
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS applicable_categories TEXT[];

-- For free_item: which product IDs can be claimed free (NULL = any in applicable_categories)
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS free_product_ids TEXT[];

-- Human-readable label for the free item (e.g. "Any Hot Coffee", "Iced Latte")
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS free_product_name TEXT;

-- ─── Rewards: BOGO specifics ────────────────────────

-- Buy X quantity (default 1)
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS bogo_buy_qty INTEGER DEFAULT 1;

-- Get Y free (default 1)
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS bogo_free_qty INTEGER DEFAULT 1;

-- How long (minutes) a pickup redemption is valid before auto-expiring (default 60)
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS expiry_minutes INTEGER DEFAULT 60;

-- ─── Rewards: channel control ───────────────────────

-- Which channels this reward is available on: ['in_store','pickup','delivery']
-- NULL = available on all channels
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS fulfillment_type TEXT[];

-- ─── Redemptions: pickup tracking ───────────────────

-- How the redemption was made
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS redemption_type TEXT DEFAULT 'in_store';
-- 'in_store' | 'pickup' | 'delivery'

-- Which outlet to collect from (for pickup/delivery)
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS pickup_outlet_id TEXT;

-- Auto-expire if not collected
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- When staff marked as collected
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ;

-- Where the redemption originated
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'portal';
-- 'portal' | 'web_app' | 'pickup_app'

-- ─── Indexes ────────────────────────────────────────

-- For pickup apps querying rewards by fulfillment type
CREATE INDEX IF NOT EXISTS idx_rewards_fulfillment ON rewards USING GIN (fulfillment_type);

-- For looking up pending pickup redemptions
CREATE INDEX IF NOT EXISTS idx_redemptions_pickup ON redemptions (pickup_outlet_id, status)
  WHERE redemption_type IN ('pickup', 'delivery');

-- For expiry cleanup
CREATE INDEX IF NOT EXISTS idx_redemptions_expires ON redemptions (expires_at)
  WHERE status = 'pending' AND expires_at IS NOT NULL;
