-- Intelligence layer for the data agent: conversation memory (so it holds a
-- real two-way thread) + a learning store (durable facts, definitions,
-- corrections, and golden queries it accumulates and applies). Server-only:
-- deny-all RLS, the agent reads/writes with the service role.
--
-- Applied 2026-07-24 via Supabase MCP (apply_migration: analyst_intelligence),
-- human in session. Audit trail per docs/database-migrations.md - do not re-run.

-- Per-chat rolling conversation so follow-ups ("why?", "what about last month")
-- have context. Pruned by reading only the most recent N turns.
create table if not exists analyst_conversations (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  role text not null,            -- 'user' | 'assistant'
  content text not null,
  asked_by text,
  created_at timestamptz not null default now()
);
create index if not exists analyst_conversations_chat_idx
  on analyst_conversations (chat_id, created_at desc);

-- What the agent has LEARNED. It recalls relevant rows into context and writes
-- new ones when the owner teaches or corrects it.
create table if not exists analyst_memory (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'fact',   -- fact | definition | preference | correction | golden_query
  content text not null,
  source text,                          -- who/what taught it (owner handle, 'self', ...)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists analyst_memory_active_idx on analyst_memory (active, created_at desc);

alter table analyst_conversations enable row level security;
alter table analyst_memory enable row level security;
