-- Bank reconciliation sign-off + bank line audit trail.
--
-- fin_bank_recons: one row per (account, month) the owner has signed off.
-- The QuickBooks-style reconcile tick: opening balance + signed sum of the
-- month's ledger lines must equal the statement closing balance (within
-- 0.01) before the sign-off endpoint accepts it. Read/written by
-- /api/finance/bank-recon and shown on the recon page's Bank recon tab.
--
-- fin_bank_line_events: append-only audit trail of every manual change to a
-- bank line's category or invoice match. Written best-effort by the
-- classify / match / unmatch / reject-match routes, read by
-- /api/finance/bank-lines/events for the per-line history view.

create table if not exists fin_bank_recons (
  id uuid primary key default gen_random_uuid(),
  account text not null,             -- BankStatement.accountName label
  month date not null,               -- first day of the month
  stated_close numeric,              -- statement closing balance
  computed_close numeric,            -- opening + signed sum of the month's lines
  delta numeric,                     -- computed_close - stated_close
  signed_off_by text,
  signed_off_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account, month)
);
alter table fin_bank_recons enable row level security;
-- service-role access only (finance client); no anon policies.

create table if not exists fin_bank_line_events (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null,             -- BankStatementLine.id
  event text not null,               -- 'classify' | 'match' | 'unmatch' | 'reject_match'
  old_value jsonb,
  new_value jsonb,
  actor text,
  created_at timestamptz not null default now()
);
create index if not exists fin_bank_line_events_line_id_idx
  on fin_bank_line_events (line_id);
alter table fin_bank_line_events enable row level security;
-- service-role access only (finance client); no anon policies.
