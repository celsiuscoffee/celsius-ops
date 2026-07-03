-- Human verdicts on AP match proposals. A rejected (bank line, invoice) pair
-- never re-surfaces in Needs Review and the auto-apply cron never applies it;
-- unmatching a wrong match records the same verdict so it stays undone.
-- Applied to production 2026-07-03 (supabase migration fin_ap_match_rejections).
create table if not exists fin_ap_match_rejections (
  id uuid primary key default gen_random_uuid(),
  bank_line_id text not null,
  invoice_id text not null,
  reason text not null default 'rejected',   -- 'rejected' | 'unmatched'
  created_at timestamptz not null default now(),
  unique (bank_line_id, invoice_id)
);
alter table fin_ap_match_rejections enable row level security;
-- service-role access only (finance client); no anon policies.
