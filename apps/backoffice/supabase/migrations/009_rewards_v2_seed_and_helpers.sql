-- ─────────────────────────────────────────────────────────────────────
-- Rewards v2 — RPC helpers + seed data
-- Run AFTER 008_rewards_v2_missions_mystery.sql has applied successfully.
-- ─────────────────────────────────────────────────────────────────────

-- ═══ Add wallet_voucher_id to orders so we can tie a redemption back
--     to its issued_rewards row at order time and mark the voucher
--     redeemed when the payment confirms.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS wallet_voucher_id text;

CREATE INDEX IF NOT EXISTS idx_orders_wallet_voucher_id
  ON public.orders(wallet_voucher_id)
  WHERE wallet_voucher_id IS NOT NULL;

-- ═══ RPC helpers used by /api/loyalty/me/mission/pick + applyOrderToMission

CREATE OR REPLACE FUNCTION public.increment_mission_picked(mission_id_param uuid)
RETURNS void AS $$
BEGIN
  UPDATE public.reward_missions
  SET total_picked = COALESCE(total_picked, 0) + 1
  WHERE id = mission_id_param;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.increment_mission_completed(mission_id_param uuid)
RETURNS void AS $$
BEGIN
  UPDATE public.reward_missions
  SET total_completed = COALESCE(total_completed, 0) + 1
  WHERE id = mission_id_param;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.increment_referral_total(member_id_param text)
RETURNS void AS $$
BEGIN
  UPDATE public.referral_codes
  SET total_referred = COALESCE(total_referred, 0) + 1
  WHERE member_id = member_id_param;
END;
$$ LANGUAGE plpgsql;

-- ═══ Add display + discount columns to issued_rewards so the wallet
--     endpoint doesn't need to JOIN voucher_templates on every read AND
--     so the checkout discount engine has everything it needs to compute
--     the discount without a second round-trip.
ALTER TABLE public.issued_rewards
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS stacks_with_beans boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS discount_type text,
  ADD COLUMN IF NOT EXISTS discount_value numeric(10,2),
  ADD COLUMN IF NOT EXISTS min_order_value numeric(10,2),
  ADD COLUMN IF NOT EXISTS applicable_categories text[],
  ADD COLUMN IF NOT EXISTS applicable_products text[],
  ADD COLUMN IF NOT EXISTS free_product_name text;

-- ═══ Seed: starter voucher templates
-- Run once with your real brand_id. Replace 'brand-celsius' if different.

INSERT INTO public.voucher_templates (brand_id, title, description, icon, category, discount_type, validity_days, stacks_with_beans)
VALUES
  ('brand-celsius', 'Free Pastry',         'Any pastry under RM10, valid on next visit',     'croissant', 'free_item',   'free_item',       14, true),
  ('brand-celsius', 'Free Add-on',         'Extra shot / oat milk / syrup — one upgrade',    'plus',      'upgrade',      'free_upgrade',    14, true),
  ('brand-celsius', '2× Beans Boost',      'Doubles Beans on your next order',               'sparkle',   'multiplier',   'beans_multiplier', 7, false),
  ('brand-celsius', 'Free Drink',          'Any regular drink, free',                        'coffee',    'free_item',    'free_item',       30, true),
  ('brand-celsius', 'RM5 Off',             'RM5 off any order above RM15',                    'percent',   'discount',     'flat',            14, true)
ON CONFLICT DO NOTHING;

-- ═══ Seed: starter mission pool
-- The reward_voucher_template_ids array stays empty here — set them in
-- the backoffice UI after these vouchers + missions exist so you can
-- pick by name without hand-rolling UUIDs.

INSERT INTO public.reward_missions (brand_id, title, description, icon, difficulty, goal, reward_voucher_template_ids, reward_bonus_beans)
VALUES
  ('brand-celsius', 'Group Order',        'One order with 3+ drinks in a single transaction',  'users',   'easy',   '{"type":"single_order_item_count","threshold":3}'::jsonb, ARRAY[]::uuid[], 0),
  ('brand-celsius', 'Early Bird',         'Order before 10am, 5 mornings this week',           'sun',     'hard',   '{"type":"orders_count","threshold":5,"filter":{"order_hour_lt":10}}'::jsonb, ARRAY[]::uuid[], 0),
  ('brand-celsius', 'Try Something New',  'Order 3 different drinks you have not tried',       'refresh', 'medium', '{"type":"distinct_new_products","threshold":3}'::jsonb, ARRAY[]::uuid[], 0),
  ('brand-celsius', 'Outlet Hopper',      'Order from 3 different Celsius outlets',            'pin',     'medium', '{"type":"distinct_outlets","threshold":3}'::jsonb, ARRAY[]::uuid[], 0),
  ('brand-celsius', 'Regular',            '5 orders this week, any time',                      'clock',   'hard',   '{"type":"orders_count","threshold":5}'::jsonb, ARRAY[]::uuid[], 0)
ON CONFLICT DO NOTHING;

-- ═══ Seed: starter mystery pool
-- Weights are relative — these total 84, so each maps to a probability
-- under 100. Tune in the backoffice → Mystery Pool page.

INSERT INTO public.mystery_pool (brand_id, label, outcome_type, multiplier_value, weight, reveal_emoji)
VALUES
  ('brand-celsius', 'Just your Beans',    'no_bonus',           NULL, 50, NULL),
  ('brand-celsius', '2× Bean Multiplier', 'beans_multiplier',    2.0, 20, '✨'),
  ('brand-celsius', '3× Bean Multiplier', 'beans_multiplier',    3.0,  8, '🎉'),
  ('brand-celsius', '5× Bean Multiplier', 'beans_multiplier',    5.0,  3, '⚡'),
  ('brand-celsius', 'Surprise at pickup', 'surprise_in_store',  NULL,  3, '🎁')
ON CONFLICT DO NOTHING;

-- ═══ admin_claimables — admin-pushed one-tap-claim offers.
--     Welcome / promotional vouchers that surface in the Vouchers tab
--     "Claim now" section. Each row defines WHO can claim and what.

CREATE TABLE IF NOT EXISTS public.admin_claimables (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id             text NOT NULL,

  title                text NOT NULL,
  description          text NOT NULL,
  voucher_template_id  uuid NOT NULL REFERENCES public.voucher_templates(id) ON DELETE RESTRICT,

  -- Who can claim. Empty member_ids[] means everyone.
  member_ids           text[] NOT NULL DEFAULT '{}',
  -- Member-segment filters; future-proof but not enforced today.
  min_tier             text,
  audience_label       text,                       -- display only, e.g. "Welcome cohort"

  -- Lifecycle
  starts_at            timestamptz DEFAULT now(),
  ends_at              timestamptz,
  max_claims           integer,                    -- null = unlimited
  total_claimed        integer NOT NULL DEFAULT 0,

  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_claimables_brand_active
  ON public.admin_claimables(brand_id, is_active);

-- Track which members have already claimed which admin_claimables —
-- enforces one-claim-per-member.
CREATE TABLE IF NOT EXISTS public.admin_claimables_claimed (
  claimable_id  uuid NOT NULL REFERENCES public.admin_claimables(id) ON DELETE CASCADE,
  member_id     text NOT NULL,
  voucher_id    text REFERENCES public.issued_rewards(id) ON DELETE SET NULL,
  claimed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (claimable_id, member_id)
);

DROP TRIGGER IF EXISTS trg_admin_claimables_updated ON public.admin_claimables;
CREATE TRIGGER trg_admin_claimables_updated
  BEFORE UPDATE ON public.admin_claimables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ═══ Referrals — short codes per member, attribution table, config
-- linking to the voucher templates that get issued to both sides.

CREATE TABLE IF NOT EXISTS public.referral_codes (
  member_id   text PRIMARY KEY,
  brand_id    text NOT NULL,
  code        text NOT NULL UNIQUE,        -- short readable code, e.g. AMMAR-7K2L
  total_referred integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_codes_brand ON public.referral_codes(brand_id);

CREATE TABLE IF NOT EXISTS public.referral_attributions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         text NOT NULL,
  referrer_id      text NOT NULL,            -- member who shared the code
  referee_id       text NOT NULL,            -- member who signed up using it
  referral_code    text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',        -- referee signed up; waiting for first qualifying order
    'rewarded',       -- both sides issued vouchers
    'voided'          -- abuse / disqualified
  )),
  referee_first_order_id uuid,
  referrer_voucher_id    text REFERENCES public.issued_rewards(id) ON DELETE SET NULL,
  referee_voucher_id     text REFERENCES public.issued_rewards(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  rewarded_at      timestamptz,
  UNIQUE (referee_id)                       -- referee can only be attributed once
);
CREATE INDEX IF NOT EXISTS idx_referral_attr_referrer ON public.referral_attributions(referrer_id);

-- Referral voucher templates live in app_config (single config row per side).
-- Backoffice page writes:
--   key='referral_referrer_voucher_template_id', value=<uuid>
--   key='referral_referee_voucher_template_id',  value=<uuid>

-- ═══ Seed: starter milestones
INSERT INTO public.reward_milestones (brand_id, title, description, icon, trigger_type, trigger_value, reward_voucher_template_ids, reward_bonus_beans)
VALUES
  ('brand-celsius', 'First Sip',          '5 lifetime orders — welcome aboard',           'coffee',  'lifetime_orders',  5,   ARRAY[]::uuid[], 50),
  ('brand-celsius', 'Coffee Veteran',     '50 lifetime orders',                            'trophy',  'lifetime_orders',  50,  ARRAY[]::uuid[], 200),
  ('brand-celsius', 'Coffee Legend',      '200 lifetime orders',                           'trophy',  'lifetime_orders',  200, ARRAY[]::uuid[], 500),
  ('brand-celsius', 'Outlet Explorer',    'Visited 3 different outlets',                   'pin',     'distinct_outlets', 3,   ARRAY[]::uuid[], 100)
ON CONFLICT DO NOTHING;
