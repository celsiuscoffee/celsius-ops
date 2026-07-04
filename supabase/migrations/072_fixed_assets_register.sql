-- Fixed assets register v2: wires the dormant fin_fixed_assets table (created
-- in apps/backoffice/supabase/migrations/002_finance_module.sql, company_id
-- added in 004_finance_multi_company.sql) to the new register UI, straight-line
-- depreciation engine and one-click capitalization of EQUIPMENTS bank lines.
--
-- The COA already carries everything depreciation needs (seeded in
-- 003_finance_coa_seed.sql): 1500-00..05 PP&E asset accounts, their 1550-xx
-- accumulated depreciation counterparts, and 6512 Depreciation of property,
-- plant and equipment. No new accounts are inserted here.
--
-- RLS: fin_fixed_assets already has row level security enabled with the shared
-- fin_read select policy for authenticated fin_user_roles holders (002); all
-- writes go through the service-role finance client. Re-asserted below for
-- safety, no new policies needed.

-- Depreciable base = cost - residual (salvage) value.
alter table fin_fixed_assets
  add column if not exists residual numeric(14,2) not null default 0;

-- The classified EQUIPMENTS bank line this asset was capitalized from, so the
-- capitalizable list can exclude already-linked lines and a line can never be
-- capitalized twice. Plain text (BankStatementLine.id is a text uuid managed
-- by Prisma) and deliberately NOT a hard FK: some feeds rebuild their lines
-- (delete + recreate) and a constraint would break those rebuilds.
alter table fin_fixed_assets
  add column if not exists source_bank_line_id text;
create unique index if not exists uq_fin_fixed_assets_source_line
  on fin_fixed_assets(source_bank_line_id) where source_bank_line_id is not null;

-- Who created the asset row (user id), for the audit trail.
alter table fin_fixed_assets
  add column if not exists created_by text;

-- 002 defined id as text primary key with no default; give it one so inserts
-- that omit id still work.
alter table fin_fixed_assets
  alter column id set default (gen_random_uuid())::text;

alter table fin_fixed_assets enable row level security;
