-- ==========================================
-- Splash posters: recurring day-part "round"
-- Lets pos-display (POS customer-screen) posters be scheduled by time of
-- day. NULL round = always show; a round-tagged poster only shows during
-- that round. Bands mirror backoffice sales/_lib/storehub-helpers ROUNDS.
-- ==========================================

ALTER TABLE splash_posters ADD COLUMN IF NOT EXISTS round TEXT;

COMMENT ON COLUMN splash_posters.round IS
  'Day-part round key (breakfast|brunch|lunch|midday|evening|dinner|supper) for recurring time-of-day scheduling on pos-display. NULL = always.';

CREATE INDEX IF NOT EXISTS idx_splash_posters_round
  ON splash_posters (brand_id, placement, active, round);
