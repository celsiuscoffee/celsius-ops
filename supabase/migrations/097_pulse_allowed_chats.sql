-- Group allowlist for the pulse bot. The owner DM is always allowed; a group
-- can query the agents only after the OWNER enables it from inside that group
-- ("@celsiuspulsebot enable"). Server-only: deny-all RLS, the webhook reads it
-- with the service role.
--
-- Applied 2026-07-23 via Supabase MCP (apply_migration: pulse_allowed_chats),
-- human in session. Audit trail per docs/database-migrations.md - do not re-run.

create table if not exists pulse_allowed_chats (
  chat_id text primary key,
  title text,
  enabled_by text,
  enabled_at timestamptz not null default now()
);

alter table pulse_allowed_chats enable row level security;
