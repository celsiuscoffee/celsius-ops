-- Learned categorization memory: every manual (user) classification teaches
-- the classifier a payee->category association, consulted before keyword
-- rules on future lines. The "understands more and more" agent, v1.
-- Applied to production 2026-07-03 (supabase migration fin_category_hints).
create table if not exists fin_category_hints (
  id uuid primary key default gen_random_uuid(),
  phrase text not null unique,          -- normalized counterparty phrase, uppercase single-spaced
  category "CashCategory" not null,
  direction text,                       -- 'DR' | 'CR' | null = both
  source text not null default 'user_correction',
  hits int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table fin_category_hints enable row level security;
-- service-role access only (finance client); no anon policies.
