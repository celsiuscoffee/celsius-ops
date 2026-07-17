-- 084: PT loop — roster acknowledgment, open shifts, WhatsApp prompt ledger.
-- Design: docs/design/pt-loop.md. Owner rules 2026-07-17: PT availability has
-- a place to be set, empty spots stay reserved and claimable, every rostered
-- staff acknowledges their week — over WhatsApp AND the staff app.
-- Server-only tables per docs/rls-strategy.md: RLS enabled, NO policies —
-- all access goes through service-role APIs (backoffice + staff app).

-- ── Roster acknowledgment on every shift row ────────────────────────────────
ALTER TABLE hr_schedule_shifts
  ADD COLUMN IF NOT EXISTS ack_status text NOT NULL DEFAULT 'pending'
    CHECK (ack_status IN ('pending', 'acknowledged', 'declined')),
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_reason text;

-- ── Open shifts: reserved, claimable holes ──────────────────────────────────
-- Sources: generator gaps no eligible PT could fill, orphaned declines,
-- day-of no-shows, or a manager reserving a slot manually. First accept wins;
-- caps + availability are enforced at claim time by the API, which then
-- writes the real hr_schedule_shifts row and links it here.
CREATE TABLE IF NOT EXISTS hr_open_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id text NOT NULL,
  shift_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_minutes int NOT NULL DEFAULT 30,
  station text NOT NULL DEFAULT 'barista' CHECK (station IN ('barista', 'kitchen')),
  role_type text,
  template_id text,
  source text NOT NULL DEFAULT 'generator'
    CHECK (source IN ('generator', 'decline', 'no_show', 'manual')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'claimed', 'expired', 'cancelled')),
  claimed_by text,
  claimed_at timestamptz,
  claimed_shift_id uuid REFERENCES hr_schedule_shifts(id) ON DELETE SET NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_open_shifts_status_date
  ON hr_open_shifts (status, shift_date);
CREATE INDEX IF NOT EXISTS idx_hr_open_shifts_outlet_date
  ON hr_open_shifts (outlet_id, shift_date);

ALTER TABLE hr_open_shifts ENABLE ROW LEVEL SECURITY;

-- ── WhatsApp prompt ledger ──────────────────────────────────────────────────
-- One row per outbound loop prompt (availability ping, roster card,
-- open-shift blast, no-show nudge) and its eventual response. Gives the cron
-- idempotency (never double-ping), the owner an audit trail, and the intent
-- parser training data.
CREATE TABLE IF NOT EXISTS hr_wa_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('availability', 'roster_ack', 'open_shift', 'no_show', 'digest')),
  ref_id text,
  week_start date,
  wamid text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  response jsonb
);
CREATE INDEX IF NOT EXISTS idx_hr_wa_prompts_user_kind_week
  ON hr_wa_prompts (user_id, kind, week_start);
CREATE INDEX IF NOT EXISTS idx_hr_wa_prompts_wamid
  ON hr_wa_prompts (wamid) WHERE wamid IS NOT NULL;

ALTER TABLE hr_wa_prompts ENABLE ROW LEVEL SECURITY;
