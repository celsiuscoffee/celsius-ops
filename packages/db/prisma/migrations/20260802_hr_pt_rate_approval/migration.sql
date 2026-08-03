-- Delegate part-timer hourly-rate changes to managers, with an approval ceiling.
-- Owner 2026-08-02: "for partimers, can you give access to ariff to change the
-- hourly pay? just put guard if the payment is more than rm11/hour, need approval".
--
-- hr_salary_history is SQL-managed like the other hr_* tables (not in
-- schema.prisma). Apply manually via Supabase SQL — hybrid workflow, see
-- docs/database-migrations.md. NEVER prisma db push / migrate deploy.
--
-- Two changes:
--   1. an approval state, so a manager's above-ceiling change can be RECORDED
--      without reaching payroll until an owner signs it off;
--   2. 'hourly_weekend' as a salary_type — part-timers have a separate weekend
--      rate (hr_employee_profiles.hourly_rate_weekend, currently RM10) that had
--      no way to be logged or superseded.
--
-- Backfill note: every existing row (44 'monthly' + 31 'hourly') predates the
-- approval flow and is already in force, so DEFAULT 'approved' is correct and
-- the NOT NULL is safe on existing data.

ALTER TABLE hr_salary_history
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS requested_by text,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hr_salary_history_status_check'
  ) THEN
    ALTER TABLE hr_salary_history
      ADD CONSTRAINT hr_salary_history_status_check
      CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- Widen salary_type: was ('monthly','hourly','daily').
ALTER TABLE hr_salary_history DROP CONSTRAINT IF EXISTS hr_salary_history_salary_type_check;
ALTER TABLE hr_salary_history
  ADD CONSTRAINT hr_salary_history_salary_type_check
  CHECK (salary_type IN ('monthly', 'hourly', 'hourly_weekend', 'daily'));

-- The owner's approval queue reads pending rows across all employees.
CREATE INDEX IF NOT EXISTS hr_salary_history_pending_idx
  ON hr_salary_history (status, effective_date)
  WHERE status = 'pending';

-- Payroll and the "current rate" lookups only ever want approved, open rows.
CREATE INDEX IF NOT EXISTS hr_salary_history_user_type_status_idx
  ON hr_salary_history (user_id, salary_type, status);

COMMENT ON COLUMN hr_salary_history.status IS
  'pending = raised by a manager above the RM11/hr self-approve ceiling, not yet in force and NOT mirrored to hr_employee_profiles; approved = live; rejected = declined by an owner.';
COMMENT ON COLUMN hr_salary_history.requested_by IS
  'User.id who raised the change. Equals created_by; kept separate so approved_by can differ.';
