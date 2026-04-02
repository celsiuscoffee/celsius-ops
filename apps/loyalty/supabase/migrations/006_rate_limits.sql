-- Rate limiting table for tracking API request counts
CREATE TABLE IF NOT EXISTS rate_limits (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_key_created ON rate_limits (key, created_at DESC);

-- Auto-cleanup: delete entries older than 1 hour
-- Run this periodically via Supabase cron or pg_cron
-- DELETE FROM rate_limits WHERE created_at < NOW() - INTERVAL '1 hour';

-- Add sms_opt_out column to members for PDPA compliance
ALTER TABLE members ADD COLUMN IF NOT EXISTS sms_opt_out BOOLEAN DEFAULT FALSE;

-- Add consent_at column to track when consent was given
ALTER TABLE members ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
