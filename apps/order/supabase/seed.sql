-- ==========================================
-- Celsius Loyalty — Seed Data
-- Mirrors demo-data.ts for local development
-- ==========================================

-- Brands
INSERT INTO brands (id, name, slug, logo_url, primary_color, secondary_color, points_per_rm, currency, is_active, created_at, updated_at)
VALUES
  ('brand-celsius', 'Celsius Coffee', 'celsius-coffee', NULL, '#1a1a1a', '#C2452D', 1, 'MYR', true, '2026-01-01T00:00:00Z', '2026-03-27T00:00:00Z'),
  ('brand-berbuka', 'BERBUKA@CELSIUS', 'berbuka-celsius', NULL, '#d97706', '#1a1a1a', 1, 'MYR', true, '2026-01-01T00:00:00Z', '2026-03-27T00:00:00Z');

-- Outlets
INSERT INTO outlets (id, brand_id, name, address, city, state, phone, storehub_store_id, is_active, created_at)
VALUES
  ('outlet-sa', 'brand-celsius', 'Shah Alam', 'Section 7, Shah Alam', 'Shah Alam', 'Selangor', '+60 3-5521 1234', '69662e56c164b700078242c9', true, '2026-01-01T00:00:00Z'),
  ('outlet-con', 'brand-celsius', 'Conezion', 'IOI Resort City, Putrajaya', 'Putrajaya', 'WP Putrajaya', '+60 3-8920 5678', '6953b9226eb8b500070a79db', true, '2026-01-15T00:00:00Z'),
  ('outlet-tam', 'brand-celsius', 'Tamarind Square', 'Persiaran Multimedia, Cyberjaya', 'Cyberjaya', 'Selangor', '+60 3-8322 9012', '68a8555979431c0007b493d2', true, '2026-02-01T00:00:00Z');

-- Members
INSERT INTO members (id, phone, name, email, birthday, preferred_outlet_id, created_at, updated_at)
VALUES
  ('member-1', '+60123456789', 'Ahmad Razak', 'ahmad@email.com', '1990-05-15', 'outlet-sa', '2026-01-10T00:00:00Z', '2026-03-25T00:00:00Z'),
  ('member-2', '+60198765432', 'Siti Aminah', 'siti@email.com', '1988-12-03', 'outlet-con', '2026-01-15T00:00:00Z', '2026-03-26T00:00:00Z'),
  ('member-3', '+60171234567', 'Lee Wei Ming', NULL, '1995-08-22', 'outlet-tam', '2026-02-01T00:00:00Z', '2026-03-27T00:00:00Z'),
  ('member-4', '+60162345678', 'Priya Nair', 'priya@email.com', '1992-03-10', 'outlet-sa', '2026-02-14T00:00:00Z', '2026-03-20T00:00:00Z'),
  ('member-5', '+60143456789', 'Nurul Huda', 'nurul@email.com', '1997-11-28', 'outlet-con', '2026-03-01T00:00:00Z', '2026-03-27T00:00:00Z');

-- Member-Brand relationships
INSERT INTO member_brands (id, member_id, brand_id, points_balance, total_points_earned, total_points_redeemed, total_visits, total_spent, joined_at, last_visit_at)
VALUES
  ('mb-1', 'member-1', 'brand-celsius', 750, 1250, 500, 28, 1250, '2026-01-10T00:00:00Z', '2026-03-25T14:30:00Z'),
  ('mb-2', 'member-2', 'brand-celsius', 1200, 1800, 600, 35, 1800, '2026-01-15T00:00:00Z', '2026-03-26T10:15:00Z'),
  ('mb-3', 'member-3', 'brand-celsius', 320, 520, 200, 12, 520, '2026-02-01T00:00:00Z', '2026-03-27T09:00:00Z'),
  ('mb-4', 'member-4', 'brand-celsius', 480, 680, 200, 15, 680, '2026-02-14T00:00:00Z', '2026-03-20T16:45:00Z'),
  ('mb-5', 'member-5', 'brand-celsius', 190, 190, 0, 8, 190, '2026-03-01T00:00:00Z', '2026-03-27T08:30:00Z');

-- Rewards
INSERT INTO rewards (id, brand_id, name, description, image_url, points_required, category, is_active, stock, max_redemptions_per_member, valid_from, valid_until, created_at, updated_at)
VALUES
  ('reward-1', 'brand-celsius', 'Free Americano', 'Any size Americano (Hot or Iced)', NULL, 500, 'drink', true, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('reward-2', 'brand-celsius', 'Free Latte', 'Any size Latte (Hot or Iced)', NULL, 800, 'drink', true, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('reward-3', 'brand-celsius', 'Free Coffee + Cake', 'Any standard coffee + slice of cake', NULL, 1500, 'food', true, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('reward-4', 'brand-celsius', '20% Off Any Drink', '20% discount on any single drink', NULL, 300, 'voucher', true, NULL, 3, NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('reward-5', 'brand-celsius', 'Celsius Tumbler', 'Exclusive branded stainless steel tumbler', NULL, 3000, 'merch', true, 50, 1, NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

-- Campaigns
INSERT INTO campaigns (id, brand_id, name, description, type, multiplier, bonus_points, message, target_segment, start_date, end_date, is_active, created_at)
VALUES
  ('camp-1', 'brand-celsius', 'Double Points Weekend', 'Earn 2x points on all purchases every Saturday & Sunday', 'multiplier', 2, NULL, NULL, 'all', '2026-03-01', '2026-04-30', true, '2026-02-25T00:00:00Z'),
  ('camp-2', 'brand-celsius', 'Welcome Bonus', '50 bonus points for all new member signups', 'bonus', NULL, 50, NULL, 'new', '2026-01-01', '2026-12-31', true, '2026-01-01T00:00:00Z');

-- Staff Users (pin_hash stores the raw pin for demo; hash in production)
INSERT INTO staff_users (id, brand_id, outlet_id, name, email, role, pin_hash, is_active, created_at)
VALUES
  ('staff-1', 'brand-celsius', 'outlet-sa', 'Faizal', 'faizal@celsius.my', 'staff', '1234', true, '2026-01-01T00:00:00Z'),
  ('staff-2', 'brand-celsius', 'outlet-con', 'Aisha', 'aisha@celsius.my', 'manager', '5678', true, '2026-01-01T00:00:00Z');

-- Point Transactions
INSERT INTO point_transactions (id, member_id, brand_id, outlet_id, type, points, balance_after, description, reference_id, multiplier, created_at, created_by)
VALUES
  ('txn-1', 'member-1', 'brand-celsius', 'outlet-sa', 'earn', 25, 750, 'Purchase - Iced Latte + Croissant', 'POS-20260325-001', 1, '2026-03-25T14:30:00Z', 'staff-1'),
  ('txn-2', 'member-2', 'brand-celsius', 'outlet-con', 'earn', 18, 1200, 'Purchase - Flat White', 'POS-20260326-042', 1, '2026-03-26T10:15:00Z', 'staff-2'),
  ('txn-3', 'member-2', 'brand-celsius', 'outlet-con', 'redeem', -500, 1182, 'Redeemed: Free Americano', 'RDM-20260324-001', 1, '2026-03-24T15:00:00Z', 'staff-2'),
  ('txn-4', 'member-5', 'brand-celsius', 'outlet-con', 'bonus', 50, 190, 'Welcome bonus - New member signup', NULL, 1, '2026-03-01T00:00:00Z', NULL);
