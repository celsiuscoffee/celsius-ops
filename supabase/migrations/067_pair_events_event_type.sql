-- Attach-rate denominator for "Pair with a Bite" (see docs/design/aov-at-pos-loop.md).
-- pos_pair_events historically logged only ADDS, so attach-rate (shown → added)
-- was uncomputable. Rows are now typed:
--   'add'        — a suggestion was added to the basket (the historic meaning;
--                  backfilled onto all existing rows via the column default)
--   'impression' — a suggestion was SHOWN (logged server-side by the
--                  suggest-pairs routes when they return a non-empty set)
--   'tap'        — pickup-cart engagement: the customer tapped a suggestion
--                  card through to the product page (not yet an add)
-- Readers that count adds (cashier scorecards, sales dashboard) filter
-- event_type = 'add'; attach rate = adds / impressions per (round, product).
ALTER TABLE pos_pair_events ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'add';

CREATE INDEX IF NOT EXISTS idx_pos_pair_events_type_time
  ON pos_pair_events (event_type, created_at);

COMMENT ON COLUMN pos_pair_events.event_type IS
  'add (suggestion added — historic default) | impression (suggestion shown) | tap (pickup card tapped to product page)';
