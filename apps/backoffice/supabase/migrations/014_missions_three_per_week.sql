-- ─────────────────────────────────────────────────────────────────────
-- Missions v2 — 3 auto-rotated weekly challenges per member.
--
-- Drops the "single active mission per week" constraint and replaces it
-- with a uniqueness guarantee on (member_id, week_start_at, mission_id)
-- so a member can hold up to 3 active assignments per week but never the
-- same mission twice. Also seeds two new missions ("Big Bill" and
-- "Refer a Friend") to round out the pool — Group Order + Try Something
-- New + Outlet Hopper + Early Bird + Regular were seeded in migration
-- 009 and stay as-is.
--
-- Milestones (table public.reward_milestones, public.user_milestones_earned)
-- are intentionally left in place — the app stops reading/writing them
-- but historical earned rows stay queryable for support.
-- ─────────────────────────────────────────────────────────────────────

-- One-shot dedupe of historical rows from the pick/swap flow where the
-- same member-week-mission triple appears more than once (production
-- had a single such case at write time). Without this, the new unique
-- constraint below fails on existing data.
DELETE FROM public.mission_assignments
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY member_id, week_start_at, mission_id
      ORDER BY created_at DESC
    ) AS rn
    FROM public.mission_assignments
  ) ranked WHERE rn > 1
);

-- Drop whatever unique constraint mission_assignments has on
-- (member_id, week_start_at, status). Constraint name is auto-generated
-- by Postgres so we look it up dynamically.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT c.conname
  INTO   con_name
  FROM   pg_constraint c
  WHERE  c.conrelid = 'public.mission_assignments'::regclass
    AND  c.contype  = 'u'
    AND  array_length(c.conkey, 1) = 3
  LIMIT  1;

  IF con_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.mission_assignments DROP CONSTRAINT %I',
      con_name
    );
  END IF;
END $$;

-- New unique guarantees: a member can hold multiple active assignments
-- per week, but never the same mission twice in the same week.
ALTER TABLE public.mission_assignments
  DROP CONSTRAINT IF EXISTS mission_assignments_member_week_mission_key;

ALTER TABLE public.mission_assignments
  ADD CONSTRAINT mission_assignments_member_week_mission_key
  UNIQUE (member_id, week_start_at, mission_id);

-- Helpful index for the "fetch all my active missions this week" query.
CREATE INDEX IF NOT EXISTS idx_mission_assignments_active_week
  ON public.mission_assignments(member_id, week_start_at)
  WHERE status = 'active';

-- ═══ Seed: new mission types
--
-- Big Bill — single order with total ≥ RM100. Threshold is in sen so
-- the existing order.total_sen field can be compared directly without
-- conversion.
--
-- Refer a Friend — one referral attributed + first-order completed.
-- Order-time evaluator returns 0 for this goal; progress is bumped from
-- attributeReferral() in lib/loyalty/v2.ts.

INSERT INTO public.reward_missions
  (brand_id, title, description, icon, difficulty, goal, reward_voucher_template_ids, reward_bonus_beans)
VALUES
  ('brand-celsius', 'Big Bill',       'Spend RM100+ in a single bill this week',
   'wallet',    'medium',
   '{"type":"single_order_total_at_least","threshold":10000}'::jsonb,
   ARRAY[]::uuid[], 0),

  ('brand-celsius', 'Refer a Friend', 'Refer one friend who places their first order',
   'user-plus', 'medium',
   '{"type":"referrals_count","threshold":1}'::jsonb,
   ARRAY[]::uuid[], 0)
ON CONFLICT DO NOTHING;
