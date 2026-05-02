-- Finance Module — multi-company support
-- Celsius operates as multiple legal entities (Sdn Bhds), each with its own
-- TIN, SST registration, and books:
--   celsius          — Celsius Coffee Sdn. Bhd. (parent / multi-outlet)
--   celsiusconezion  — Celsius Coffee Conezion (the Conezion outlet's SPV)
--   celsiustamarind  — Celsius Coffee Tamarind (the Tamarind outlet's SPV)
--
-- The COA is shared across companies (consolidation-friendly), but every
-- transaction, bill, invoice, period, SST filing, and fixed asset belongs
-- to exactly ONE company. Reports filter by company. Each company has its
-- own MyInvois TIN/BRN configured per row.
--
-- Outlets map to companies many-to-one via fin_outlet_companies (an outlet
-- could be reassigned over time without forking the Outlet table).


-- ─── Companies ─────────────────────────────────────────────
create table if not exists fin_companies (
  id                text primary key,                       -- short slug, e.g. "celsius"
  name              text not null,                          -- "Celsius Coffee Sdn. Bhd."
  legal_name        text,                                   -- full registered name
  brn               text,                                   -- SSM number e.g. "201501026187"
  tin               text,                                   -- LHDN TIN, e.g. "C12345678901"
  sst_registration  text,                                   -- "W10-1234-5678..."
  msic_code         text not null default '56101',          -- F&B service activities
  -- Address used on e-invoice issuer block
  address_line1     text,
  address_line2     text,
  city              text,
  state             text,
  postcode          text,
  country           text not null default 'MYS',
  contact_phone     text,
  contact_email     text,
  -- MyInvois config can override per-company env vars (rare, but supports
  -- e.g. one company in sandbox while others go live)
  myinvois_env      text default 'inherit',                 -- inherit|sandbox|prod|disabled
  myinvois_client_id     text,
  myinvois_client_secret text,
  is_active         boolean not null default true,
  is_default        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists ux_fin_companies_default on fin_companies(is_default) where is_default;


-- ─── Outlet → Company mapping ──────────────────────────────
-- An outlet belongs to exactly one company at a time. Effective dates would
-- let us model historical reassignments; v1 tracks current ownership only.
create table if not exists fin_outlet_companies (
  outlet_id   text primary key references "Outlet"(id) on delete cascade,
  company_id  text not null references fin_companies(id) on delete restrict,
  assigned_at timestamptz not null default now()
);
create index if not exists idx_fin_outlet_companies_company on fin_outlet_companies(company_id);


-- ─── Add company_id to all ledger-side tables ─────────────
-- Nullable so we can backfill in 005; a future migration will set NOT NULL
-- once the seed populates everything.

alter table fin_transactions add column if not exists company_id text references fin_companies(id) on delete restrict;
create index if not exists idx_fin_transactions_company on fin_transactions(company_id);
create index if not exists idx_fin_transactions_company_period on fin_transactions(company_id, period);

alter table fin_invoices add column if not exists company_id text references fin_companies(id) on delete restrict;
create index if not exists idx_fin_invoices_company on fin_invoices(company_id);

alter table fin_bills add column if not exists company_id text references fin_companies(id) on delete restrict;
create index if not exists idx_fin_bills_company on fin_bills(company_id);

alter table fin_fixed_assets add column if not exists company_id text references fin_companies(id) on delete restrict;
create index if not exists idx_fin_fixed_assets_company on fin_fixed_assets(company_id);

alter table fin_documents add column if not exists company_id text references fin_companies(id) on delete restrict;
create index if not exists idx_fin_documents_company on fin_documents(company_id);

alter table fin_exceptions add column if not exists company_id text references fin_companies(id) on delete restrict;
create index if not exists idx_fin_exceptions_company on fin_exceptions(company_id);


-- Periods are per company. The PK was just `period`; new schema keys on
-- (company_id, period). We carry the old PK forward by dropping + recreating
-- — only safe because nothing has been posted yet (development-stage).
alter table fin_periods add column if not exists company_id text references fin_companies(id) on delete restrict;
do $$
declare
  pk_name text;
begin
  select conname into pk_name
    from pg_constraint
    where conrelid = 'fin_periods'::regclass and contype = 'p';
  if pk_name is not null then
    execute format('alter table fin_periods drop constraint %I', pk_name);
  end if;
end $$;
-- New uniqueness per (company, period). Allow company_id null during the
-- nullable transition; once 005 populates, a follow-up migration sets NOT NULL.
create unique index if not exists ux_fin_periods_company_period on fin_periods(company_id, period);


-- Same for SST filings: was unique on period, now per (company_id, period).
alter table fin_sst_filings add column if not exists company_id text references fin_companies(id) on delete restrict;
drop index if exists fin_sst_filings_period_key;
do $$
declare
  uq_name text;
begin
  select conname into uq_name
    from pg_constraint
    where conrelid = 'fin_sst_filings'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%(period)%';
  if uq_name is not null then
    execute format('alter table fin_sst_filings drop constraint %I', uq_name);
  end if;
end $$;
create unique index if not exists ux_fin_sst_filings_company_period on fin_sst_filings(company_id, period);


-- User roles can scope to a company (in addition to outlet).
alter table fin_user_roles add column if not exists company_id text references fin_companies(id) on delete cascade;
create index if not exists idx_fin_user_roles_company on fin_user_roles(company_id);


-- ─── Audit log on companies + outlet mapping ──────────────
do $$
declare t text;
begin
  for t in
    select unnest(array['fin_companies','fin_outlet_companies'])
  loop
    execute format('drop trigger if exists trg_%s_audit on %s', t, t);
    execute format(
      'create trigger trg_%s_audit after insert or update or delete on %s
       for each row execute function fin_audit()', t, t
    );
  end loop;
end $$;


-- ─── updated_at touch on companies ─────────────────────────
drop trigger if exists trg_fin_companies_touch on fin_companies;
create trigger trg_fin_companies_touch before update on fin_companies
  for each row execute function fin_touch_updated_at();


-- ─── RLS for new tables ────────────────────────────────────
alter table fin_companies enable row level security;
alter table fin_outlet_companies enable row level security;

drop policy if exists fin_read on fin_companies;
create policy fin_read on fin_companies for select to authenticated
  using (exists (select 1 from fin_user_roles ur where ur.user_id = auth.uid()::text));
drop policy if exists fin_read on fin_outlet_companies;
create policy fin_read on fin_outlet_companies for select to authenticated
  using (exists (select 1 from fin_user_roles ur where ur.user_id = auth.uid()::text));
