-- Applied 2026-07-16 via Supabase MCP (apply_migration: agent_messages), human
-- in session. Audit trail per docs/database-migrations.md - do not re-run.
-- (Numbered 090 to clear the 080-089 collisions from parallel sessions.)
--
-- Agent communications log: the human-readable record of what the agents say
-- to each other, what they learn, and when their logic changes. Sits on top of
-- the substrate (migration 080). agent_actions = what one agent DID;
-- agent_messages = what one agent TOLD another (or the owner), in plain English.
--
-- Every row is written to be read by a person, not a machine: `summary` is a
-- full sentence naming both sides ("Reviews agent flagged X to the Ops agent").
-- Each row can be pushed to the pulse Telegram channel in real time and rolled
-- into a daily digest.
--
-- from_agent / to_agent are plain text, NOT FKs: to_agent is often "owner" or
-- "human" (not a registry key), and the registry churns, so a hard FK would
-- reject legitimate messages. When from_agent IS a registry key the /agents
-- panel links it back.

create table if not exists agent_messages (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  from_agent text not null,                 -- registry key, or 'system'
  to_agent text,                            -- registry key | 'owner' | 'human' | 'ops team' | null
  kind text not null default 'handoff'
    check (kind in ('handoff', 'learning', 'logic_change', 'report')),
  summary text not null,                    -- one plain-English sentence naming both sides
  detail text,                              -- optional longer human-readable context
  ref_table text,
  ref_id text,
  outlet_id text,
  meta jsonb not null default '{}'::jsonb,
  notified_at timestamptz,                  -- pushed to the pulse channel in real time
  digested_at timestamptz,                  -- included in a daily digest
  created_at timestamptz not null default now()
);
alter table agent_messages enable row level security;
create index if not exists agent_messages_at_idx on agent_messages (at desc);
create index if not exists agent_messages_from_idx on agent_messages (from_agent, at desc);
create index if not exists agent_messages_to_idx on agent_messages (to_agent, at desc);
create index if not exists agent_messages_kind_idx on agent_messages (kind, at desc);
create index if not exists agent_messages_undigested_idx on agent_messages (digested_at) where digested_at is null;

-- Register the daily digest cron as an agent so it shows on /agents. (Applied
-- 2026-07-16 alongside the table above.)
insert into agent_registry (key, name, domain, description, mode, kind, trigger_detail, uses_llm, code_path)
values ('agent_comms_digest', 'Agent comms daily digest', 'ops',
  'Once a day, posts a plain-English roundup of what the agents told each other, learned, and changed to the pulse Telegram channel.',
  'armed', 'cron', '0 13 * * *', false,
  'apps/backoffice/src/app/api/cron/agent-comms-digest/route.ts')
on conflict (key) do nothing;
