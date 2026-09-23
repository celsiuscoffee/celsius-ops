-- Terminal diagnostics: results of the in-app GHL/ADAPTIS terminal probe.
--
-- The payment terminal only answers on the outlet LAN, and no developer
-- machine is on that network. The till IS on it, so the POS runs the probe
-- and files the result here, where it can be read remotely instead of being
-- copied off a screen by hand.
--
-- Diagnostic data only: HTTP status codes, headers and response snippets from
-- a device on the shop network. No cardholder data and no payment ever passes
-- through this path — the probe can only issue GETs and a QUERY STATUS for a
-- reference that does not exist.
create table if not exists public.terminal_diagnostics (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  outlet_id   text,
  host        text not null,
  port        integer not null,
  report      jsonb not null
);

create index if not exists terminal_diagnostics_created_idx
  on public.terminal_diagnostics (created_at desc);

alter table public.terminal_diagnostics enable row level security;

-- The till authenticates anonymously (same as the rest of its reads), so the
-- anon role needs insert. Insert-only on purpose: a till never needs to read
-- back or amend another outlet's diagnostics, and withholding select keeps
-- this from becoming a general-purpose read channel.
drop policy if exists terminal_diagnostics_anon_insert on public.terminal_diagnostics;
create policy terminal_diagnostics_anon_insert
  on public.terminal_diagnostics for insert to anon with check (true);
