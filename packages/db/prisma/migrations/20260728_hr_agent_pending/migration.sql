-- HR Ops Agent stage 2 — pending-action store for the two-step confirm flow.
-- Design: docs/design/hr-ops-agent.md §"Write guardrails".
--
-- Every agent write is STAGED here first with a short single-use confirm code;
-- it executes only when the designated confirmer's phone replies
-- "CONFIRM <code>". SQL-managed like the other hr_* tables (not in
-- schema.prisma); accessed via prisma raw SQL from the tool layer only.
-- RLS enabled with no policies = deny-all for anon/authenticated PostgREST
-- (house pattern) — the backoffice reaches it over the direct Prisma
-- connection where the table owner bypasses RLS.
--
-- Apply: manually via Supabase SQL (hybrid workflow, docs/database-migrations.md).

CREATE TABLE IF NOT EXISTS hr_agent_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,               -- short confirm code, e.g. 'H7K2'
  action_type text NOT NULL,               -- write-ops allowlist key
  payload jsonb NOT NULL,                  -- validated structured operation
  card text NOT NULL,                      -- human-readable record card shown at staging
  requested_by text NOT NULL,              -- User.id of the requester
  requester_role text NOT NULL,
  confirmer_id text NOT NULL,              -- User.id whose phone must send CONFIRM
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','executed','rejected','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  executed_at timestamptz,
  result jsonb
);

CREATE INDEX IF NOT EXISTS hr_agent_pending_actions_status_idx
  ON hr_agent_pending_actions (status, expires_at);
CREATE INDEX IF NOT EXISTS hr_agent_pending_actions_confirmer_idx
  ON hr_agent_pending_actions (confirmer_id, status);

ALTER TABLE hr_agent_pending_actions ENABLE ROW LEVEL SECURITY;
