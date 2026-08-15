-- Pause the habit loop (owner decision 2026-08-15, applied live).
-- -8.7pp lift and -RM837 net cash over 469 sends. The auto-pause rule could
-- not reach it: its pooled holdout only ever hit 16 against a 30 floor (small
-- pool x 10% holdout x 80/day cap), so a clearly-bleeding loop was structurally
-- unkillable. Shipped alongside: holdout raised to 25% on the small-pool loops,
-- and a bleed escape hatch in autoPauseUnderperformers so this can't recur.
UPDATE app_settings
SET value = value || jsonb_build_object(
  'habit', jsonb_build_object(
    'at', '2026-08-15T13:45:00Z',
    'reason', 'owner: -8.7pp lift, -RM837 net cash over 469 sends - bleeding, and holdout (16) too small for the auto-pause floor (30) to reach it'
  ))
WHERE key = 'loops_paused'
  AND NOT (value ? 'habit');
