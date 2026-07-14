-- Applied 2026-07-15 via Supabase MCP (apply_migration: agent_substrate),
-- human in session. Audit trail per docs/database-migrations.md — do not re-run.
--
-- Agent substrate: the shared rails every autonomous actor plugs into, so new
-- agents inherit infrastructure instead of reinventing flags/queues/telemetry
-- per domain. Three tables:
--
--   agent_registry    one row per autonomous actor (cron, webhook, LLM agent,
--                     pg_cron, scheduled task). Holds the canonical mode
--                     (off|shadow|armed) — the kill switch lives HERE, in the
--                     DB, flippable from /agents without a redeploy. Legacy
--                     env-var flags are noted in kill_switch_note until their
--                     readers migrate.
--   agent_actions     append-only action ledger: what acted, on what, with
--                     what confidence/cost, and whether a human later
--                     overrode it. Feeds the /agents panel and arming reviews.
--   campaign_outcomes outcome ledger for marketing/loyalty moves so the
--                     Friday loops read last cycle's measured results instead
--                     of proposing from static priors.
--
-- Server-only (service-role via backoffice); RLS enabled deny-all like the
-- migration-075 batch. No PostgREST anon exposure.

create table if not exists agent_registry (
  key text primary key,                     -- stable slug, e.g. 'reviews_auto_reply'
  name text not null,
  domain text not null,                     -- finance|reviews|marketing|procurement|hr|ops|pos|loyalty
  description text not null default '',
  mode text not null default 'off' check (mode in ('off','shadow','armed')),
  kind text not null default 'cron',        -- cron|webhook|manual|pg_cron|scheduled_task
  trigger_detail text,                      -- cron expr or route/webhook path
  uses_llm boolean not null default false,
  model text,                               -- current model id when uses_llm
  arming_criteria text,                     -- pre-committed: "armed when X over N weeks"
  arming_review_date date,
  kill_switch_note text,                    -- legacy flag location until reader migrates
  code_path text,
  last_run_at timestamptz,
  last_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table agent_registry enable row level security;

create table if not exists agent_actions (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null references agent_registry(key),
  at timestamptz not null default now(),
  kind text not null,                       -- sms_sent|reply_posted|journal_posted|proposal|escalation|skip|...
  summary text not null,
  ref_table text,                           -- domain record acted on
  ref_id text,
  outlet_id text,
  confidence numeric(4,3),
  autonomous boolean not null default true, -- false = human-initiated/approved path
  human_override boolean,                   -- set later when a human reverses/edits the action
  model text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10,6),
  meta jsonb not null default '{}'::jsonb
);
alter table agent_actions enable row level security;
create index if not exists agent_actions_agent_at_idx on agent_actions (agent_key, at desc);
create index if not exists agent_actions_at_idx on agent_actions (at desc);
create index if not exists agent_actions_ref_idx on agent_actions (ref_table, ref_id);

create table if not exists campaign_outcomes (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null,               -- loop name / brief slug / segment id
  source text not null,                     -- sms_loop|round_gap|friday_brief|loyalty_tuner|poster_autopilot|campaigns_auto
  outlet_id text,
  segment text,
  started_at timestamptz not null,
  ended_at timestamptz,
  hypothesis text,                          -- the move + expected effect
  target_metric text not null,              -- orders|aov|round_revenue|repeat_rate
  control text,                             -- holdout/control description
  sends int,
  cost_rm numeric(12,2),
  baseline_value numeric(14,2),
  result_value numeric(14,2),
  uplift_pct numeric(8,4),
  verdict text check (verdict in ('win','neutral','loss','invalid')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table campaign_outcomes enable row level security;
create index if not exists campaign_outcomes_key_idx on campaign_outcomes (campaign_key, started_at desc);
create index if not exists campaign_outcomes_source_idx on campaign_outcomes (source, started_at desc);
