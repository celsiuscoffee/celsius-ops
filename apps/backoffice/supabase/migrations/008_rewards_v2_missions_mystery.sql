-- ─────────────────────────────────────────────────────────────────────
-- Rewards v2 — Missions, Mystery Bean, Streaks, Milestones
-- Adds engagement-layer tables on top of existing loyalty
-- (loyalty_members, rewards, issued_rewards stay as-is)
-- ─────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════
-- MISSIONS — admin-curated weekly challenges
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.reward_missions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        text NOT NULL,

  -- Display
  title           text NOT NULL,
  description     text NOT NULL,
  icon            text NOT NULL DEFAULT 'sparkle',
  difficulty      text NOT NULL CHECK (difficulty IN ('easy','medium','hard')),

  -- Goal definition (machine-readable)
  -- e.g. {"type":"orders_count","threshold":5,"filter":{"order_hour_lt":10}}
  goal            jsonb NOT NULL,

  -- Reward — list of voucher_template_ids granted on completion
  reward_voucher_template_ids uuid[] NOT NULL DEFAULT '{}',
  reward_bonus_beans          integer NOT NULL DEFAULT 0,

  -- Pool management
  is_active       boolean NOT NULL DEFAULT true,
  starts_at       timestamptz,
  ends_at         timestamptz,
  cooldown_weeks  integer NOT NULL DEFAULT 4,  -- min weeks before re-offering to same customer

  -- Analytics
  total_picked    integer NOT NULL DEFAULT 0,
  total_completed integer NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX IF NOT EXISTS idx_reward_missions_brand_active
  ON public.reward_missions(brand_id, is_active);

-- ═══════════════════════════════════════════════════════
-- MISSION_ASSIGNMENTS — customer picks one per week
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mission_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        text NOT NULL,
  mission_id       uuid NOT NULL REFERENCES public.reward_missions(id) ON DELETE RESTRICT,

  -- Week window — Mon 00:00 to Sun 23:59 of customer local time
  week_start_at    timestamptz NOT NULL,
  week_end_at      timestamptz NOT NULL,

  -- Progress
  progress_current integer NOT NULL DEFAULT 0,
  progress_target  integer NOT NULL,

  -- Lifecycle
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','expired','swapped')),
  completed_at     timestamptz,
  expired_at       timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- A customer has at most ONE active mission per week window
  UNIQUE (member_id, week_start_at, status) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_mission_assignments_member
  ON public.mission_assignments(member_id, status);
CREATE INDEX IF NOT EXISTS idx_mission_assignments_week
  ON public.mission_assignments(week_start_at);

-- ═══════════════════════════════════════════════════════
-- MYSTERY_POOL — reveal outcomes + probabilities
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mystery_pool (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                 text NOT NULL,

  -- Display
  label                    text NOT NULL,           -- e.g. "3× Bean Multiplier"
  icon                     text NOT NULL DEFAULT 'sparkle',
  reveal_emoji             text,                    -- displayed inside reveal card

  -- Outcome
  outcome_type             text NOT NULL CHECK (outcome_type IN (
    'beans_multiplier','flat_beans','voucher','no_bonus','surprise_in_store'
  )),
  multiplier_value         numeric(4,2),            -- for beans_multiplier (e.g. 2.0, 3.0, 5.0)
  flat_beans_value         integer,                 -- for flat_beans
  voucher_template_id      uuid,                    -- for voucher

  -- Probability
  weight                   integer NOT NULL CHECK (weight >= 0), -- relative weight, normalized at pick time

  -- Optional targeting
  min_tier                 text,                    -- restrict to tier and above
  birthday_month_boost     boolean NOT NULL DEFAULT false, -- doubles weight if user's birthday month

  is_active                boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mystery_pool_brand_active
  ON public.mystery_pool(brand_id, is_active);

-- ═══════════════════════════════════════════════════════
-- MYSTERY_DROPS — log of what each user got per order
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mystery_drops (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id           text NOT NULL,
  order_id            uuid,
  pool_entry_id       uuid NOT NULL REFERENCES public.mystery_pool(id) ON DELETE RESTRICT,

  -- What they got
  outcome_type        text NOT NULL,
  multiplier_applied  numeric(4,2),
  beans_awarded       integer,
  voucher_id          text,                          -- references issued_rewards.id

  revealed_at         timestamptz,                   -- when customer tapped to reveal
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mystery_drops_member
  ON public.mystery_drops(member_id);
CREATE INDEX IF NOT EXISTS idx_mystery_drops_order
  ON public.mystery_drops(order_id);

-- ═══════════════════════════════════════════════════════
-- USER_STREAKS — weekly visit streaks
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_streaks (
  member_id            text PRIMARY KEY,
  current_streak_weeks integer NOT NULL DEFAULT 0,
  longest_streak_weeks integer NOT NULL DEFAULT 0,
  last_order_week_start timestamptz,
  saver_available      boolean NOT NULL DEFAULT true,  -- "Streak saver" — once per quarter
  saver_last_used_at   timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════
-- USER_MILESTONES — lifetime achievements
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.reward_milestones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        text NOT NULL,

  title           text NOT NULL,                -- e.g. "Coffee Veteran"
  description     text NOT NULL,
  icon            text NOT NULL DEFAULT 'star',

  trigger_type    text NOT NULL CHECK (trigger_type IN (
    'lifetime_orders','lifetime_beans','distinct_outlets','streak_weeks'
  )),
  trigger_value   integer NOT NULL,

  reward_voucher_template_ids uuid[] NOT NULL DEFAULT '{}',
  reward_bonus_beans          integer NOT NULL DEFAULT 0,
  reward_unlock               text,             -- arbitrary unlock key, e.g. "lifetime_platinum"

  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_milestones_earned (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     text NOT NULL,
  milestone_id  uuid NOT NULL REFERENCES public.reward_milestones(id) ON DELETE CASCADE,
  earned_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (member_id, milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_user_milestones_member
  ON public.user_milestones_earned(member_id);

-- ═══════════════════════════════════════════════════════
-- VOUCHER_TEMPLATES — catalog for missions/mystery to reference
-- (issued_rewards rows are instances of these templates)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.voucher_templates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id             text NOT NULL,

  title                text NOT NULL,                 -- "Free Pastry"
  description          text NOT NULL,                 -- "Any pastry under RM10"
  icon                 text NOT NULL DEFAULT 'ticket',
  category             text NOT NULL CHECK (category IN (
    'free_item','upgrade','discount','multiplier','special'
  )),

  -- Redemption value
  discount_type        text CHECK (discount_type IN (
    'flat','percent','free_item','free_upgrade','beans_multiplier','none'
  )),
  discount_value       numeric(10,2),
  max_discount_value   numeric(10,2),
  multiplier_value     numeric(4,2),

  -- Eligibility
  min_order_value      numeric(10,2),
  applicable_categories text[],
  applicable_products  text[],
  free_product_ids     text[],
  free_product_name    text,
  fulfillment_type     text[],
  outlets_allowlist    text[],                       -- empty = all outlets

  -- Stacking & limits
  stacks_with_beans    boolean NOT NULL DEFAULT true,
  stacks_with_other    boolean NOT NULL DEFAULT false,

  -- Expiry defaults (used when issued)
  validity_days        integer NOT NULL DEFAULT 14,

  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voucher_templates_brand
  ON public.voucher_templates(brand_id, is_active);

-- ═══════════════════════════════════════════════════════
-- Extend issued_rewards (vouchers) with template reference
-- Safe additive ALTER — won't break existing rows
-- ═══════════════════════════════════════════════════════

ALTER TABLE public.issued_rewards
  ADD COLUMN IF NOT EXISTS voucher_template_id uuid,
  ADD COLUMN IF NOT EXISTS source_type text CHECK (source_type IN (
    'mission','mystery','birthday','referral','milestone','manual','points_redemption'
  )),
  ADD COLUMN IF NOT EXISTS source_ref_id text;

CREATE INDEX IF NOT EXISTS idx_issued_rewards_template
  ON public.issued_rewards(voucher_template_id);

-- ═══════════════════════════════════════════════════════
-- Updated_at triggers (reuse existing function if it exists)
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reward_missions_updated ON public.reward_missions;
CREATE TRIGGER trg_reward_missions_updated
  BEFORE UPDATE ON public.reward_missions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_mission_assignments_updated ON public.mission_assignments;
CREATE TRIGGER trg_mission_assignments_updated
  BEFORE UPDATE ON public.mission_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_mystery_pool_updated ON public.mystery_pool;
CREATE TRIGGER trg_mystery_pool_updated
  BEFORE UPDATE ON public.mystery_pool
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_voucher_templates_updated ON public.voucher_templates;
CREATE TRIGGER trg_voucher_templates_updated
  BEFORE UPDATE ON public.voucher_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_reward_milestones_updated ON public.reward_milestones;
CREATE TRIGGER trg_reward_milestones_updated
  BEFORE UPDATE ON public.reward_milestones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ═══════════════════════════════════════════════════════
-- Seed: starter mission pool, starter mystery pool
-- (commented out — run manually after confirming brand_id)
-- ═══════════════════════════════════════════════════════

-- INSERT INTO reward_missions (brand_id, title, description, icon, difficulty, goal, reward_bonus_beans)
-- VALUES
--   ('<BRAND_ID>', 'Group Order',        'One order with 3+ drinks',           'users',  'easy',   '{"type":"single_order_item_count","threshold":3}', 0),
--   ('<BRAND_ID>', 'Early Bird',         'Order before 10am, 5 mornings',      'sun',    'hard',   '{"type":"orders_count","threshold":5,"filter":{"order_hour_lt":10}}', 0),
--   ('<BRAND_ID>', 'Try Something New',  'Order 3 drinks you have not tried',  'refresh','medium', '{"type":"distinct_new_products","threshold":3}', 0),
--   ('<BRAND_ID>', 'Outlet Hopper',      'Order from 3 different outlets',     'pin',    'medium', '{"type":"distinct_outlets","threshold":3}', 0),
--   ('<BRAND_ID>', 'Regular',            '5 orders this week, any time',       'clock',  'hard',   '{"type":"orders_count","threshold":5}', 0);

-- INSERT INTO mystery_pool (brand_id, label, outcome_type, multiplier_value, weight, reveal_emoji) VALUES
--   ('<BRAND_ID>', 'Just your Beans',    'no_bonus',          NULL, 50, NULL),
--   ('<BRAND_ID>', '2× Bean Multiplier', 'beans_multiplier',  2.0,  20, '✨'),
--   ('<BRAND_ID>', '3× Bean Multiplier', 'beans_multiplier',  3.0,  8,  '🎉'),
--   ('<BRAND_ID>', '5× Bean Multiplier', 'beans_multiplier',  5.0,  3,  '⚡');
