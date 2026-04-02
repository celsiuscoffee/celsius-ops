-- ==========================================
-- RPC Functions for atomic operations
-- ==========================================

-- ─── deduct_points ──────────────────────────────────
-- Atomically deduct points from a member's balance.
-- Returns the new balance, or -1 if insufficient points.
-- Prevents race conditions on concurrent redemptions.

CREATE OR REPLACE FUNCTION deduct_points(
  p_member_id TEXT,
  p_brand_id TEXT,
  p_points INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Lock the row to prevent concurrent modifications
  SELECT points_balance INTO v_current_balance
  FROM member_brands
  WHERE member_id = p_member_id AND brand_id = p_brand_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  -- If p_points is negative, we're adding points back (rollback)
  IF p_points > 0 AND v_current_balance < p_points THEN
    RETURN -1; -- Insufficient points
  END IF;

  v_new_balance := v_current_balance - p_points;

  UPDATE member_brands
  SET
    points_balance = v_new_balance,
    total_points_redeemed = CASE
      WHEN p_points > 0 THEN total_points_redeemed + p_points
      ELSE total_points_redeemed  -- Don't adjust on rollback
    END
  WHERE member_id = p_member_id AND brand_id = p_brand_id;

  RETURN v_new_balance;
END;
$$;

-- ─── increment_sms_count ────────────────────────────
-- Atomically increment the sms_sent count on a campaign.
-- Used after SMS blast sends to update campaign stats.

CREATE OR REPLACE FUNCTION increment_sms_count(
  p_campaign_id TEXT,
  p_count INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE campaigns
  SET sms_sent = COALESCE(sms_sent, 0) + p_count
  WHERE id = p_campaign_id;
END;
$$;

-- ─── Rate limits cleanup ────────────────────────────
-- Scheduled cleanup for rate_limits table.
-- If using pg_cron (available on Supabase Pro+), uncomment:
--
-- SELECT cron.schedule(
--   'cleanup-rate-limits',
--   '*/15 * * * *',  -- every 15 minutes
--   $$DELETE FROM rate_limits WHERE created_at < NOW() - INTERVAL '1 hour'$$
-- );
--
-- Otherwise, call this manually or via a Supabase Edge Function on a schedule:
-- DELETE FROM rate_limits WHERE created_at < NOW() - INTERVAL '1 hour';
