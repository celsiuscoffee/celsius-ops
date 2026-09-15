-- Stamp the rostered shift's unpaid break onto the attendance log at clock-in.
--
-- Owner 2026-09-15: "roster break_minutes should be authoritative."
--
-- WHY. hr_attendance_logs already stamps the rostered WINDOW at clock-in
-- (scheduled_start / scheduled_end / scheduled_date) so that every later
-- recompute — the AI processor, a manager's set_times edit, the auto-close cron
-- — agrees on what was rostered even if the roster is edited afterwards. The
-- unpaid break was the one piece of that shift missing, so deriveHours fell back
-- to a hardcoded cohort rule instead: 1 hour for full-timers.
--
-- That 1 hour was the only place in the system saying anything other than 30
-- minutes. All nine shift templates are break_minutes 30, every roster row in
-- production is 30, and the weekly PT calculator already reads the roster's own
-- value. Full-timers were docked an extra half hour on every shift over 5h.
--
-- NULL = no rostered break recorded (a cover shift with no roster row, or any
-- log written before this column existed). deriveHours falls back to the cohort
-- rule for those, so old rows keep computing exactly as they do today.
--
-- NOTE: hr_* tables are SQL-managed and absent from schema.prisma, so there is
-- no Prisma-side change to match. Apply manually via the Supabase SQL editor —
-- hybrid workflow, docs/database-migrations.md.
-- NEVER prisma db push / prisma migrate deploy.

ALTER TABLE hr_attendance_logs
  ADD COLUMN IF NOT EXISTS scheduled_break_minutes SMALLINT;

ALTER TABLE hr_attendance_logs
  DROP CONSTRAINT IF EXISTS hr_attendance_logs_scheduled_break_minutes_range;

ALTER TABLE hr_attendance_logs
  ADD CONSTRAINT hr_attendance_logs_scheduled_break_minutes_range
  CHECK (scheduled_break_minutes IS NULL
         OR (scheduled_break_minutes >= 0 AND scheduled_break_minutes <= 480));

COMMENT ON COLUMN hr_attendance_logs.scheduled_break_minutes IS
  'Unpaid break from the rostered shift, stamped at clock-in alongside scheduled_start/_end. Authoritative for pay. NULL = no roster row (cover shift) or pre-dates the column; deriveHours then falls back to the cohort default.';
