-- SMS marketing "loop engine" — multi-arm reactivation / frequency campaigns
-- with a holdout control, rewards auto-tagged to the member, and honest
-- attribution. See docs/design/sms-loop-engineering.md.
--
-- A "round" is one execution of a loop (e.g. Win Back round 3). Each round
-- splits its eligible segment into a holdout (control, no reward/no SMS) plus
-- one or more treatment arms (each a reward offer). Attribution compares each
-- arm against the holdout — that's the whole point of the loop.

CREATE TABLE IF NOT EXISTS loop_rounds (
  id            text PRIMARY KEY,
  brand_id      text NOT NULL DEFAULT 'brand-celsius',
  loop_key      text NOT NULL,                          -- winback | birthday | weekly_round | welcome
  round_no      integer NOT NULL DEFAULT 1,
  segment_label text NOT NULL,                          -- human description of who was targeted
  holdout_pct   numeric NOT NULL DEFAULT 20,
  arms          jsonb   NOT NULL DEFAULT '[]'::jsonb,   -- [{key,label,voucher_template_id,message}]
  attribution_window_days integer NOT NULL DEFAULT 7,
  status        text NOT NULL DEFAULT 'prepared',       -- prepared|approved|sent|measured|cancelled
  stats         jsonb,                                  -- per-arm results, filled at measure time
  created_by    text,
  prepared_at   timestamptz NOT NULL DEFAULT now(),
  approved_at   timestamptz,
  sent_at       timestamptz,
  measured_at   timestamptz
);

CREATE TABLE IF NOT EXISTS loop_assignments (
  id               text PRIMARY KEY,
  round_id         text NOT NULL REFERENCES loop_rounds(id) ON DELETE CASCADE,
  member_id        text NOT NULL,
  phone            text NOT NULL,
  arm              text NOT NULL,                        -- 'holdout' | <arm key>
  issued_reward_id text,                                 -- issued_rewards.id for treatment arms
  sms_status       text,                                 -- sent | failed | null (holdout)
  sms_message_id   text,
  -- attribution (filled at measure time)
  reward_redeemed  boolean NOT NULL DEFAULT false,
  converted        boolean NOT NULL DEFAULT false,       -- placed an order within the window
  order_revenue    numeric,
  assigned_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_loop_assignments_round ON loop_assignments(round_id);
CREATE INDEX IF NOT EXISTS idx_loop_assignments_phone ON loop_assignments(phone);
CREATE INDEX IF NOT EXISTS idx_loop_rounds_key ON loop_rounds(loop_key, round_no);

-- Backoffice-only tables accessed via the service role (supabaseAdmin), which
-- bypasses RLS. Enable RLS with NO policies so the anon/auth keys can never read
-- member PII (phone) stored here.
ALTER TABLE loop_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE loop_assignments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE loop_rounds IS 'One execution round of an SMS marketing loop (holdout + arms). See docs/design/sms-loop-engineering.md';
COMMENT ON TABLE loop_assignments IS 'Per-recipient arm/holdout assignment for a loop round; holdout rows (no reward, no SMS) make attribution honest.';
