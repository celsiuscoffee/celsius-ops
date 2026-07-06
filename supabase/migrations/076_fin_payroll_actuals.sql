-- Per outlet per month full-time payroll actuals from the BrioHR Payroll Ledger.
-- Gross earnings + employer statutory (EPF/SOCSO/EIS), tagged to the real outlet
-- (outlet_id NULL = HQ management, attributed to the celsius entity). Part-timer
-- wages are NOT here (they stay on the outlet-tagged PARTIMER bank lines). The
-- sourced P&L people-cost reads this as the authoritative payroll source for the
-- months it covers; the draft monthly hr_payroll runs cover the uncovered tail.
-- Data is loaded separately from the ledger export, not in this migration.
create table if not exists fin_payroll_actuals (
  id uuid primary key default gen_random_uuid(),
  period date not null,                             -- first day of the payroll month
  outlet_id text,                                   -- NULL for HQ (entity-level management)
  company_id text not null,
  outlet_label text,
  salary numeric(14,2) not null default 0,          -- gross earnings
  employer_stat numeric(14,2) not null default 0,   -- employer EPF/SOCSO/EIS
  headcount int not null default 0,
  source text not null default 'briohr_ledger_2026',
  created_at timestamptz not null default now(),
  unique (period, company_id, outlet_id)
);
alter table fin_payroll_actuals enable row level security;
