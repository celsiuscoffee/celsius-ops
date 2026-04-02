-- ==========================================
-- Performance Indexes
-- Composite indexes for common query patterns
-- ==========================================

-- members: unique phone lookup (already has single-column idx_members_phone,
-- but adding a unique index to enforce at DB level beyond the UNIQUE constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_phone_unique ON members(phone);

-- member_brands: active member queries filtered by brand, sorted by last visit
CREATE INDEX IF NOT EXISTS idx_member_brands_brand_last_visit
  ON member_brands(brand_id, last_visit_at);

-- member_brands: top spender queries filtered by brand, sorted by total spent descending
CREATE INDEX IF NOT EXISTS idx_member_brands_brand_top_spent
  ON member_brands(brand_id, total_spent DESC);

-- point_transactions: transaction history for a member within a brand, newest first
CREATE INDEX IF NOT EXISTS idx_point_txn_member_brand_created
  ON point_transactions(member_id, brand_id, created_at DESC);

-- point_transactions: dashboard stats — filter by brand + type, sorted by date
CREATE INDEX IF NOT EXISTS idx_point_txn_brand_type_created
  ON point_transactions(brand_id, type, created_at);

-- point_transactions: storehub comparison queries by outlet
CREATE INDEX IF NOT EXISTS idx_point_txn_outlet
  ON point_transactions(outlet_id);

-- redemptions: redemption queries filtered by brand, member, and status
CREATE INDEX IF NOT EXISTS idx_redemptions_brand_member_status
  ON redemptions(brand_id, member_id, status);

-- sms_logs: SMS log queries filtered by brand, sorted by date descending
-- (005 already has separate idx_sms_logs_brand and idx_sms_logs_created,
--  this composite index covers both filter + sort in a single scan)
CREATE INDEX IF NOT EXISTS idx_sms_logs_brand_created
  ON sms_logs(brand_id, created_at DESC);

-- campaigns: campaign listing filtered by brand and active status
CREATE INDEX IF NOT EXISTS idx_campaigns_brand_active
  ON campaigns(brand_id, is_active);

-- issued_rewards: issued rewards queries filtered by brand and status
CREATE INDEX IF NOT EXISTS idx_issued_rewards_brand_status
  ON issued_rewards(brand_id, status);

-- issued_rewards: member lookup
CREATE INDEX IF NOT EXISTS idx_issued_rewards_member
  ON issued_rewards(member_id);

-- member_brands: joined_at for monthly stats
CREATE INDEX IF NOT EXISTS idx_member_brands_brand_joined
  ON member_brands(brand_id, joined_at DESC);

-- ─── Aggregation RPC (avoids fetching all 20k+ rows for dashboard sums) ───
CREATE OR REPLACE FUNCTION get_brand_aggregates(p_brand_id TEXT)
RETURNS JSON AS $$
  SELECT json_build_object(
    'total_points_earned', COALESCE(SUM(total_points_earned), 0),
    'total_points_redeemed', COALESCE(SUM(total_points_redeemed), 0),
    'total_spent', COALESCE(SUM(total_spent), 0),
    'floating_points', COALESCE(SUM(points_balance), 0)
  )
  FROM member_brands
  WHERE brand_id = p_brand_id;
$$ LANGUAGE SQL STABLE;
