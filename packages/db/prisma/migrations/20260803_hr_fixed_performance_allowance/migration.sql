-- Flat (unscored) performance allowance for roles the lever engine can't score.
--
-- Owner 2026-08-03: Ariff is to receive RM100 performance allowance. His scheme
-- is RM100 of an eventual RM500 pool driven by COGS and people-cost levers —
-- but those levers do not exist yet, so it is paid FLAT until they do.
--
-- Why a new column rather than hr_employee_profiles.performance_allowance_amount:
-- that column is BOTH dead and polluted. The payroll calculator never reads it
-- (computeAllowancesForUser takes the pool from hr_company_settings, a single
-- company-wide RM200 — verified: every line on the Jul 2026 run records
-- "pool": 200 including Syafiq Kaberi whose profile says 300, and the ten people
-- whose profiles say 100). Making that column live would move ~12 people's pay
-- as a side effect of paying Ariff. It stays dead here, deliberately.
--
-- Semantics of the new column:
--   NULL  -> unchanged. Scored against the company pool by the lever engine.
--   0..n  -> paid FLAT at this amount. No levers, no lateness/absence
--            deductions, no review penalties. It also bypasses the
--            schedule_required eligibility gate, which is the point: Ariff is
--            Head of Department, not rostered, so schedule_required is false and
--            the lever engine forces his allowance to RM0 whatever else is set.
--
-- Partial months still prorate downstream in payroll-calculator.ts (joiner /
-- resigner), same as a scored allowance.
--
-- SQL-managed table (not in schema.prisma). Apply manually via Supabase SQL —
-- hybrid workflow, docs/database-migrations.md. NEVER prisma db push / migrate deploy.

ALTER TABLE hr_employee_profiles
  ADD COLUMN IF NOT EXISTS fixed_performance_allowance numeric;

COMMENT ON COLUMN hr_employee_profiles.fixed_performance_allowance IS
  'When set, the performance allowance is paid FLAT at this amount — lever engine, attendance deductions and the schedule_required gate are all bypassed. NULL = scored against the company pool as normal. Introduced for unrostered roles (Head of Department) whose levers (COGS, people cost) are not built yet.';

-- Ariff (ops@celsiuscoffee.com): RM100 flat, pending the COGS / people-cost levers.
-- Scoped by email rather than a hardcoded uuid so this reads as intent.
UPDATE hr_employee_profiles
SET fixed_performance_allowance = 100,
    updated_at = now()
WHERE user_id = (SELECT id FROM "User" WHERE email = 'ops@celsiuscoffee.com');
