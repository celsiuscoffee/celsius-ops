-- Day-part WINDOW for posters: a poster may now appear across a SET of rounds
-- (e.g. a pasta lunch→supper, breakfast food all morning), not just one 2-hour
-- slot. NULL/empty `rounds` falls back to the legacy single `round` (and a null
-- `round` still means always-on). Readers + the autopilot engine prefer
-- `rounds` when present.
ALTER TABLE splash_posters ADD COLUMN IF NOT EXISTS rounds text[];

COMMENT ON COLUMN splash_posters.rounds IS
  'Day-part eligibility window (breakfast..supper). NULL/empty = fall back to single `round` (null round = always-on). Reader shows poster when current round is in this set.';
