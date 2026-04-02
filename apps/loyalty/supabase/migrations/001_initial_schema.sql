-- ==========================================
-- Celsius Loyalty — Initial Schema
-- Multi-tenant loyalty system
-- ==========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Brands
CREATE TABLE brands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  primary_color TEXT DEFAULT '#1a1a1a',
  secondary_color TEXT DEFAULT '#C2452D',
  points_per_rm DECIMAL(10,2) DEFAULT 1.0,
  currency TEXT DEFAULT 'MYR',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Outlets
CREATE TABLE outlets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  phone TEXT,
  storehub_store_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Members
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT UNIQUE NOT NULL, -- stored as +60XXXXXXXXX
  name TEXT,
  email TEXT,
  birthday DATE,
  preferred_outlet_id UUID REFERENCES outlets(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Member-Brand relationship (multi-brand support)
CREATE TABLE member_brands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
  points_balance INTEGER DEFAULT 0,
  total_points_earned INTEGER DEFAULT 0,
  total_points_redeemed INTEGER DEFAULT 0,
  total_visits INTEGER DEFAULT 0,
  total_spent DECIMAL(10,2) DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT now(),
  last_visit_at TIMESTAMPTZ,
  UNIQUE(member_id, brand_id)
);

-- Point Transactions (audit trail)
CREATE TABLE point_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id),
  type TEXT NOT NULL CHECK (type IN ('earn', 'redeem', 'bonus', 'expire', 'adjust')),
  points INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description TEXT,
  reference_id TEXT, -- POS transaction ID
  multiplier DECIMAL(3,1) DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID
);

-- Rewards
CREATE TABLE rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  points_required INTEGER NOT NULL,
  category TEXT DEFAULT 'drink' CHECK (category IN ('drink', 'food', 'voucher', 'merch')),
  is_active BOOLEAN DEFAULT true,
  stock INTEGER, -- NULL = unlimited
  max_redemptions_per_member INTEGER,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Redemptions
CREATE TABLE redemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  reward_id UUID REFERENCES rewards(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id),
  points_spent INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'used', 'cancelled')),
  code TEXT UNIQUE NOT NULL,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Campaigns
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('multiplier', 'bonus', 'broadcast')),
  multiplier DECIMAL(3,1) DEFAULT 1.0,
  bonus_points INTEGER DEFAULT 0,
  message TEXT,
  target_segment TEXT DEFAULT 'all',
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Staff Users
CREATE TABLE staff_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id),
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  role TEXT DEFAULT 'staff' CHECK (role IN ('admin', 'manager', 'staff')),
  pin_hash TEXT, -- hashed 4-digit PIN
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- OTP codes (for phone verification)
CREATE TABLE otp_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT DEFAULT 'login' CHECK (purpose IN ('login', 'redeem')),
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_members_phone ON members(phone);
CREATE INDEX idx_member_brands_member ON member_brands(member_id);
CREATE INDEX idx_member_brands_brand ON member_brands(brand_id);
CREATE INDEX idx_point_transactions_member ON point_transactions(member_id);
CREATE INDEX idx_point_transactions_brand ON point_transactions(brand_id);
CREATE INDEX idx_redemptions_code ON redemptions(code);
CREATE INDEX idx_redemptions_member ON redemptions(member_id);
CREATE INDEX idx_otp_codes_phone ON otp_codes(phone);
CREATE INDEX idx_outlets_brand ON outlets(brand_id);
CREATE INDEX idx_rewards_brand ON rewards(brand_id);

-- Enable RLS
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow anon read for public-facing data
CREATE POLICY "Public read brands" ON brands FOR SELECT USING (true);
CREATE POLICY "Public read outlets" ON outlets FOR SELECT USING (true);
CREATE POLICY "Public read rewards" ON rewards FOR SELECT USING (true);
CREATE POLICY "Public read campaigns" ON campaigns FOR SELECT USING (true);

-- Service role has full access (for API routes)
CREATE POLICY "Service full access brands" ON brands FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access outlets" ON outlets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access members" ON members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access member_brands" ON member_brands FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access point_transactions" ON point_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access rewards" ON rewards FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access redemptions" ON redemptions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access campaigns" ON campaigns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access staff_users" ON staff_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access otp_codes" ON otp_codes FOR ALL USING (true) WITH CHECK (true);
