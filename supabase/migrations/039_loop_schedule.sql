-- Win-back loops Phase B: scheduled sends + send-time learning.
-- Each round can be scheduled to fire at a chosen time/window; a cron
-- (/api/cron/loops-send) sends due rounds. send_window records which
-- day-part the SMS went out so the engine can learn the best time.
ALTER TABLE loop_rounds
  ADD COLUMN IF NOT EXISTS scheduled_send_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_window text;

-- Cron looks up due rounds by (status, scheduled_send_at); index it.
CREATE INDEX IF NOT EXISTS idx_loop_rounds_due
  ON loop_rounds (status, scheduled_send_at)
  WHERE scheduled_send_at IS NOT NULL;
