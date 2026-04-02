-- ==========================================
-- SMS Logs & Credits Tracking
-- ==========================================

-- SMS log table — tracks every SMS sent
CREATE TABLE IF NOT EXISTS sms_logs (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  campaign_id TEXT REFERENCES campaigns(id),
  member_id TEXT REFERENCES members(id),
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'failed', 'pending')),
  provider TEXT DEFAULT 'console',
  provider_message_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

-- SMS credits table — tracks credit purchases and usage
CREATE TABLE IF NOT EXISTS sms_credits (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  type TEXT NOT NULL CHECK (type IN ('purchase', 'usage', 'refund')),
  amount INTEGER NOT NULL, -- positive for purchase/refund, negative for usage
  balance_after INTEGER NOT NULL,
  description TEXT,
  campaign_id TEXT REFERENCES campaigns(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add sms_message field to campaigns for SMS blast type
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sms_message TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sms_sent_count INTEGER DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sms_sent_at TIMESTAMPTZ;

-- Add SMS credit balance to brands
ALTER TABLE brands ADD COLUMN IF NOT EXISTS sms_credits_balance INTEGER DEFAULT 0;

-- Enable RLS
ALTER TABLE sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_credits ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Allow read sms_logs" ON sms_logs FOR SELECT USING (true);
CREATE POLICY "Allow insert sms_logs" ON sms_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow read sms_credits" ON sms_credits FOR SELECT USING (true);
CREATE POLICY "Allow insert sms_credits" ON sms_credits FOR INSERT WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_sms_logs_brand ON sms_logs(brand_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_campaign ON sms_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_created ON sms_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_credits_brand ON sms_credits(brand_id);
