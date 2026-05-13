-- Weekly-chest streak gamification.
--
-- Every week a customer orders, the streak cron mints a "chest" they
-- can claim. Each chest has a tier based on the customer's CURRENT
-- streak weeks — so the first chest is small, the 4-week chest is
-- meaningful, and the 12-week chest is significant. This turns the
-- streak from a passive number into a weekly dopamine moment.
--
-- Two tables:
--   streak_chest_tiers  — admin config: what each tier contains
--   streak_weekly_chests — per-customer-per-week claim state

CREATE TABLE IF NOT EXISTS public.streak_chest_tiers (
  brand_id              text NOT NULL,
  streak_floor          int  NOT NULL,
  label                 text NOT NULL,
  description           text,
  bonus_beans           int  NOT NULL DEFAULT 0,
  voucher_template_id   uuid REFERENCES public.voucher_templates(id) ON DELETE SET NULL,
  emoji                 text NOT NULL DEFAULT '🎁',
  PRIMARY KEY (brand_id, streak_floor)
);

ALTER TABLE public.streak_chest_tiers DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.streak_weekly_chests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id           text NOT NULL,
  brand_id            text NOT NULL,
  week_start          timestamptz NOT NULL,
  streak_at_qualify   int  NOT NULL,
  tier_floor          int  NOT NULL,
  qualified_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  claimed_at          timestamptz,
  claim_outcome       jsonb,
  UNIQUE (member_id, brand_id, week_start)
);

ALTER TABLE public.streak_weekly_chests DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_streak_weekly_chests_member
  ON public.streak_weekly_chests(member_id);

CREATE INDEX IF NOT EXISTS idx_streak_weekly_chests_unclaimed
  ON public.streak_weekly_chests(member_id) WHERE claimed_at IS NULL;

INSERT INTO public.streak_chest_tiers (brand_id, streak_floor, label, description, bonus_beans, voucher_template_id, emoji) VALUES
  ('brand-celsius', 1,  'Weekly chest',     'A small thank-you for showing up this week.',                25,  NULL,                                          '🎁'),
  ('brand-celsius', 4,  'Hot chest',        '1-month streak — you''ve got a habit going.',                 75,  '7ff18b84-61e6-48d4-aafc-204680578df1',        '🔥'),
  ('brand-celsius', 8,  'Flame chest',      '2-month streak — Celsius is part of your routine.',           150, '2d1484c3-8d79-45f6-a5ff-939fa25dc747',        '🌟'),
  ('brand-celsius', 12, 'Legendary chest',  '3 months running. This one''s on us.',                        300, '9cb1a485-4e68-46a9-a8f1-0dec4519c641',        '🏆'),
  ('brand-celsius', 24, 'Eternal chest',    '6 months. You''re a Celsius regular.',                        700, '9cb1a485-4e68-46a9-a8f1-0dec4519c641',        '👑')
ON CONFLICT (brand_id, streak_floor) DO NOTHING;
