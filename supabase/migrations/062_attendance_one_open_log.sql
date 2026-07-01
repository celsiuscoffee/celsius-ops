-- Prevent a double clock-in creating two overlapping OPEN logs.
--
-- The clock-in guard is a non-atomic check-then-insert: two rapid taps, a retry,
-- or a flaky-network resubmit can both pass the "already clocked in?" SELECT
-- before either INSERT lands, leaving a user with two open logs. Clock-out then
-- closes only the newest, and the cron auto-closes the orphan later at the wrong
-- time = a phantom second shift with wrong hours. This partial unique index lets
-- the DB reject the second open log; the route maps the 23505 conflict to a
-- friendly "Already clocked in".
CREATE UNIQUE INDEX IF NOT EXISTS hr_attendance_logs_one_open_per_user
  ON hr_attendance_logs (user_id)
  WHERE clock_out IS NULL;
