-- Member-level holdout for the cart AOV challenge nudge, so we can PROVE it
-- lifts AOV/frequency: a random slice never sees the nudge; the report compares
-- their order AOV + mission completion against the treatment group. Variant is
-- stored (not hashed) so the endpoint + report always agree.
CREATE TABLE IF NOT EXISTS challenge_nudge_assignment (
  member_id   text PRIMARY KEY,
  variant     text NOT NULL CHECK (variant IN ('treatment','holdout')),
  assigned_at timestamptz NOT NULL DEFAULT now()
);

-- Flag: toggle the holdout + its size. Set enabled=false (or pct=0) to give the
-- nudge to everyone once it's proven.
INSERT INTO app_settings (key, value)
VALUES ('challenge_nudge_holdout', '{"enabled":true,"pct":20}'::jsonb)
ON CONFLICT (key) DO NOTHING;
