-- Points expiry, earning limits, and reward types enhancements

-- Add loyalty settings columns to brands table
ALTER TABLE brands ADD COLUMN IF NOT EXISTS points_expiry_months INTEGER DEFAULT 0; -- 0 = no expiry
ALTER TABLE brands ADD COLUMN IF NOT EXISTS daily_earning_limit INTEGER DEFAULT 0; -- 0 = unlimited
ALTER TABLE brands ADD COLUMN IF NOT EXISTS points_expiry_enabled BOOLEAN DEFAULT FALSE;

-- Add reward_type to rewards table (new_member, birthday, points_shop, or standard)
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS reward_type TEXT DEFAULT 'standard'
  CHECK (reward_type IN ('standard', 'new_member', 'birthday', 'points_shop'));
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS auto_issue BOOLEAN DEFAULT FALSE;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS validity_days INTEGER DEFAULT NULL; -- days after issue before expiry
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS birthday_days_before INTEGER DEFAULT NULL; -- days before birthday to issue

-- Track issued auto-rewards to prevent duplicates
CREATE TABLE IF NOT EXISTS issued_rewards (
  id TEXT PRIMARY KEY,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  reward_id TEXT REFERENCES rewards(id) ON DELETE CASCADE,
  brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
  issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired')),
  code TEXT UNIQUE,
  year INTEGER -- for birthday rewards, track which year it was issued
);

-- Points expiry tracking - individual point batches with expiry dates
CREATE TABLE IF NOT EXISTS point_batches (
  id TEXT PRIMARY KEY,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
  points_earned INTEGER NOT NULL,
  points_remaining INTEGER NOT NULL,
  earned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE, -- NULL = never expires
  is_expired BOOLEAN DEFAULT FALSE
);

-- Enable RLS
ALTER TABLE issued_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service role" ON issued_rewards FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON point_batches FOR ALL USING (true);
