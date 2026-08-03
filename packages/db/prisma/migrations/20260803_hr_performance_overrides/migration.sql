-- Manual override of a month's performance allowance.
--
-- Owner 2026-08-03: "create a performance review page so that we can edit
-- performance and deductions manually."
--
-- The lever engine scores checklist / phone capture / serving time / audit and
-- nets off attendance and negative-review deductions. It is right most of the
-- time and wrong some of the time — a lever that had no data, an absence that
-- was actually excused, a review that wasn't the staffer's fault. Until now the
-- only ways to correct it were a flat all-months amount
-- (fixed_performance_allowance) or editing the payroll line after the fact,
-- which loses the reason.
--
-- This is scoped to ONE PERSON, ONE MONTH, with a mandatory reason and an audit
-- trail. It does not disturb the engine for anyone else and it does not persist
-- into the next month — the levers go back to deciding unless someone overrides
-- again, which is the point: an override is a correction, not a new policy.
--
-- Precedence, highest first:
--   1. hr_performance_overrides (this table) — one person, one month
--   2. hr_employee_profiles.fixed_performance_allowance — one person, every month
--   3. the lever engine scored against hr_company_settings.performance_allowance_amount
--
-- NOTE: hr_employee_profiles.performance_allowance_amount is a DEAD column —
-- written by /api/hr/allowance-overrides and by the employee form, read by
-- nothing. Do not confuse it with either of the above. Whether to revive it is
-- still an owner decision; it is deliberately untouched here.
--
-- SQL-managed table (not in schema.prisma). Apply manually via Supabase SQL —
-- hybrid workflow, docs/database-migrations.md. NEVER prisma db push / migrate deploy.

CREATE TABLE IF NOT EXISTS hr_performance_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),

  -- The performance allowance to PAY for this month, before proration.
  -- NULL is not allowed: an override row exists precisely to state an amount.
  override_amount numeric NOT NULL CHECK (override_amount >= 0),

  -- What the engine had computed when the override was made. Kept so the page
  -- can show "engine said RM120, we paid RM200" long after the underlying
  -- attendance or audit data has moved on.
  computed_amount numeric,

  -- Mandatory: an unexplained pay override is worse than no override.
  reason text NOT NULL CHECK (length(trim(reason)) > 0),

  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One override per person per month; the page upserts on this.
  UNIQUE (user_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS hr_performance_overrides_period_idx
  ON hr_performance_overrides (period_year, period_month);

COMMENT ON TABLE hr_performance_overrides IS
  'Manual per-person, per-month override of the computed performance allowance. Takes precedence over hr_employee_profiles.fixed_performance_allowance and over the lever engine. Does not carry into the next month.';

ALTER TABLE hr_performance_overrides ENABLE ROW LEVEL SECURITY;
