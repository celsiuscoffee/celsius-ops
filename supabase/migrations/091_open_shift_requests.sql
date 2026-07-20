-- Open-slot booking becomes REQUEST → ASSIGN (owner 2026-07-19: "they
-- request, we assign"). Staff no longer instant-claim a slot from the apps;
-- they raise a hand, several can, and the manager assigns one — only then
-- does the real hr_schedule_shifts row materialize. (The WhatsApp TAKE flow
-- keeps instant claim: it exists for urgent decline/no-show backfill.)
--
-- Additive only. RLS enabled with no policies — server-only via service role,
-- same convention as hr_open_shifts (084).

create table if not exists hr_open_shift_requests (
  id uuid primary key default gen_random_uuid(),
  open_shift_id uuid not null references hr_open_shifts(id) on delete cascade,
  user_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'assigned', 'declined', 'withdrawn')),
  note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  unique (open_shift_id, user_id)
);

create index if not exists idx_osr_slot on hr_open_shift_requests (open_shift_id, status);
create index if not exists idx_osr_user on hr_open_shift_requests (user_id, status);

alter table hr_open_shift_requests enable row level security;

comment on table hr_open_shift_requests is
  'Staff hand-raises on hr_open_shifts. Manager assigns one pending request; the rest are declined. Server-only (no RLS policies).';
