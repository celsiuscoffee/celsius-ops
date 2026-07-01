-- Attendance: stamp the ROSTER DATE on each log so lateness / shift-end math is
-- cross-midnight safe.
--
-- scheduled_start / scheduled_end are `time` (a MYT wall clock, no date). To turn
-- them into an instant you need the shift's calendar day. Deriving it from the
-- clock-in's date breaks a Supper shift (scheduled 23:00, clocked 00:10 next day)
-- and any pre-08:00 opening shift (UTC is the previous day). We stamp the roster's
-- own shift_date at clock-in instead. Nullable + additive: existing logs stay NULL
-- (no schedule → no lateness penalty, the safe default), new logs get it when a
-- matching hr_schedule_shifts row exists.
ALTER TABLE hr_attendance_logs
  ADD COLUMN IF NOT EXISTS scheduled_date date;

COMMENT ON COLUMN hr_attendance_logs.scheduled_date IS
  'MYT calendar date of the rostered shift this log matched at clock-in (from hr_schedule_shifts.shift_date). Pairs with scheduled_start/scheduled_end to build a MYT instant for lateness and shift-end auto-close.';
