-- Celsius Pulse (Telegram data advisor) — conversation memory.
-- Applied to kqdcdhpnyuwrxqhbuyfl on 2026-06-12 via MCP (pulse_advisor_messages).
--
-- Companion (run out-of-band, NOT in migration history — contains a password):
--   create role advisor_readonly login password '...' nosuperuser nocreatedb nocreaterole connection limit 8;
--   alter role advisor_readonly set statement_timeout = '10s';
--   alter role advisor_readonly set default_transaction_read_only = on;
--   alter role advisor_readonly set idle_in_transaction_session_timeout = '15s';
--   alter role advisor_readonly bypassrls;
--   grant usage on schema public to advisor_readonly;
--   grant select on all tables in schema public to advisor_readonly;
--   alter default privileges in schema public grant select on tables to advisor_readonly;

create table if not exists public.advisor_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists advisor_messages_chat_created_idx
  on public.advisor_messages (chat_id, created_at desc);

-- Written by the backoffice route via Prisma (postgres role); RLS on with no
-- policies so anon/authenticated cannot read chat history.
alter table public.advisor_messages enable row level security;

grant select on public.advisor_messages to advisor_readonly;
