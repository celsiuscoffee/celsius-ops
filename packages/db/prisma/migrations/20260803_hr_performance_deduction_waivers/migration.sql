-- Waive ONE deduction line instead of overriding the whole month.
--
-- Owner 2026-08-03: "make the override by each line (absence, late, etc)".
--
-- hr_performance_overrides (applied earlier today) replaces a person's entire
-- outcome for a month with a single figure. That is the right tool when the
-- engine is wrong about everything, and the wrong tool for the common case:
-- ONE absence that was actually approved leave, ONE lateness on a day the
-- roster was changed verbally, ONE review the staffer wasn't on shift for.
-- Using the whole-month override for those loses the lever scoring entirely
-- and hides what was actually corrected.
--
-- A waiver names a single deduction and says what to charge for it instead.
-- Everything else — the levers, the other deductions — keeps computing.
--
-- deduction_key identifies the line and must be STABLE across recomputes:
--   late|<attendance_log_id>     lateness penalty on that clock-in
--   absent|<attendance_log_id>   "very late, counted as absent" on that clock-in
--   noshow|<YYYY-MM-DD>          rostered shift with no clock-in (deduped per day)
--   review|<hr_review_penalty_id>  manager-approved negative review
-- Keyed on the row id rather than a position in a list, so re-running the
-- engine cannot silently move a waiver onto a different day's deduction.
--
-- waived_amount is what to charge INSTEAD, not the discount: 0 waives the line
-- entirely, 10 charges RM10 where the engine wanted RM20. The engine clamps it
-- to [0, computed], so a waiver can only ever REDUCE a deduction. That bound is
-- what makes this safe to delegate to a MANAGER while the whole-month override
-- (which sets pay outright) stays OWNER/ADMIN.
--
-- Precedence, highest first:
--   1. hr_performance_overrides            — whole month, one figure, OWNER/ADMIN
--   2. hr_employee_profiles.fixed_performance_allowance — flat, every month
--   3. the lever engine, minus deductions, each of which THIS table can reduce
-- A whole-month override short-circuits before deductions are computed at all,
-- so waivers on a month that also has an override are inert (not deleted —
-- removing the override brings them back).
--
-- SQL-managed table (not in schema.prisma). Apply manually via Supabase SQL —
-- hybrid workflow, docs/database-migrations.md. NEVER prisma db push / migrate deploy.

CREATE TABLE IF NOT EXISTS hr_performance_deduction_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),

  -- Which line. See the key formats above.
  deduction_key text NOT NULL CHECK (length(trim(deduction_key)) > 0),

  -- What to charge for this line instead. 0 = fully waived.
  waived_amount numeric NOT NULL DEFAULT 0 CHECK (waived_amount >= 0),

  -- What the engine wanted to charge, captured at waive time so the page can
  -- still show "engine said RM20, we charged RM0" after the underlying
  -- attendance data has moved on.
  computed_amount numeric,

  -- Human-readable copy of the line at waive time ("Late 34m", "No-show").
  -- Display only: if the underlying row is deleted the waiver is inert, and
  -- this is all that is left to explain it in the audit trail.
  label text,

  -- Mandatory: an unexplained pay correction is worse than no correction.
  reason text NOT NULL CHECK (length(trim(reason)) > 0),

  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One waiver per line per person per month; the page upserts on this.
  UNIQUE (user_id, period_year, period_month, deduction_key)
);

CREATE INDEX IF NOT EXISTS hr_performance_deduction_waivers_period_idx
  ON hr_performance_deduction_waivers (period_year, period_month);

COMMENT ON TABLE hr_performance_deduction_waivers IS
  'Per-line reduction of a computed performance-allowance deduction (late / absent / no-show / negative review). waived_amount is what to charge instead, clamped to [0, computed] so it can only reduce. Does not carry into the next month.';

ALTER TABLE hr_performance_deduction_waivers ENABLE ROW LEVEL SECURITY;
