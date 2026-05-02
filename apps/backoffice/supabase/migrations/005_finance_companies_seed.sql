-- Finance Module — companies seed
-- Seeds the three Celsius legal entities with codes matching their Bukku
-- subdomains. TIN/BRN/SST values are placeholders — finance ops fills them
-- in on the company settings page once LHDN registration completes.
-- "celsius" is the default; outlets default to it unless mapped otherwise.

insert into fin_companies (id, name, legal_name, brn, tin, msic_code, country, is_active, is_default) values
  ('celsius',         'Celsius Coffee Sdn. Bhd.',     'Celsius Coffee Sdn. Bhd.', '201501026187', null, '56101', 'MYS', true, true),
  ('celsiusconezion', 'Celsius Coffee Conezion',      null,                       null,           null, '56101', 'MYS', true, false),
  ('celsiustamarind', 'Celsius Coffee Tamarind',      null,                       null,           null, '56101', 'MYS', true, false)
on conflict (id) do nothing;

-- Map outlets to companies. Two outlets are SPVs of their own companies;
-- everything else rolls up to the parent "celsius".
--
-- We resolve outlet ids by code so the seed survives reseeds.
insert into fin_outlet_companies (outlet_id, company_id)
  select o.id, 'celsiusconezion' from "Outlet" o where lower(o.code) like 'conezion%' or lower(o.name) like '%conezion%'
  on conflict (outlet_id) do nothing;

insert into fin_outlet_companies (outlet_id, company_id)
  select o.id, 'celsiustamarind' from "Outlet" o where lower(o.code) like 'tamarind%' or lower(o.name) like '%tamarind%'
  on conflict (outlet_id) do nothing;

-- Default everything else to "celsius".
insert into fin_outlet_companies (outlet_id, company_id)
  select o.id, 'celsius' from "Outlet" o
  where not exists (select 1 from fin_outlet_companies oc where oc.outlet_id = o.id)
  on conflict (outlet_id) do nothing;

-- Backfill nullable company_id columns with the default 'celsius' so existing
-- rows (none in production yet, but possible from dev data) don't break the
-- not-null pass we'll do later. Where outlet is set, prefer that mapping.
update fin_transactions t
   set company_id = coalesce(
     (select oc.company_id from fin_outlet_companies oc where oc.outlet_id = t.outlet_id),
     'celsius'
   )
   where company_id is null;

update fin_invoices i
   set company_id = coalesce(
     (select oc.company_id from fin_outlet_companies oc where oc.outlet_id = i.outlet_id),
     'celsius'
   )
   where company_id is null;

update fin_bills b
   set company_id = coalesce(
     (select oc.company_id from fin_outlet_companies oc where oc.outlet_id = b.outlet_id),
     'celsius'
   )
   where company_id is null;

update fin_fixed_assets fa
   set company_id = coalesce(
     (select oc.company_id from fin_outlet_companies oc where oc.outlet_id = fa.outlet_id),
     'celsius'
   )
   where company_id is null;

update fin_documents d
   set company_id = coalesce(
     (select oc.company_id from fin_outlet_companies oc where oc.outlet_id = d.outlet_id),
     'celsius'
   )
   where company_id is null;

update fin_periods set company_id = 'celsius' where company_id is null;
update fin_sst_filings set company_id = 'celsius' where company_id is null;
update fin_exceptions set company_id = 'celsius' where company_id is null;
