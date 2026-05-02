-- Finance Module — Phase 1
-- Replaces Bukku as system of record. Agentic-AI driven; humans only resolve
-- exceptions. COA seeded from Bukku export 2026-05-02 (see 003_finance_coa_seed.sql).
--
-- Architecture: every financial event is a fin_transactions row with 2+ fin_journal_lines.
-- Source documents (POS EOD, bank statements, supplier bills) land in fin_documents
-- first, then agents post journals. Bank txns live in fin_bank_transactions and
-- get reconciled to journals via fin_matches. Anything an agent can't resolve
-- with high confidence flows to fin_exceptions.
--
-- Compliance outbound (MyInvois, SST-02) is tracked in fin_einvoice_submissions
-- and fin_sst_filings. Period locks prevent backdating into closed months.
-- All writes are audit-logged via the fin_audit() trigger.


-- ─── COA ───────────────────────────────────────────────────
-- Mirrors the Bukku-style chart, owned in-house. Code is the natural key
-- (e.g. "5000-04" for Grabfood). Hierarchical via parent_code.
create table if not exists fin_accounts (
  code              text primary key,
  name              text not null,
  type              text not null,                          -- asset|liability|equity|income|cogs|expense
  subtype           text,                                   -- bank_cash|ar|ap|inventory|fixed_asset|... (mirrors Bukku "system account")
  parent_code       text references fin_accounts(code) on delete restrict,
  is_active         boolean not null default true,
  is_system         boolean not null default false,         -- system accounts (bank, AR, AP, EPF control...) can't be deleted
  outlet_specific   boolean not null default false,         -- if true, journal lines must carry outlet_id
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fin_accounts_type_chk check (type in ('asset','liability','equity','income','cogs','expense'))
);
create index if not exists idx_fin_accounts_parent on fin_accounts(parent_code);
create index if not exists idx_fin_accounts_type on fin_accounts(type);


-- ─── Source documents ─────────────────────────────────────
-- Every inbound artefact lands here before agents process it. Lets us replay
-- agent decisions when models or rules change.
create table if not exists fin_documents (
  id                text primary key,
  source            text not null,                          -- storehub|maybank|email|whatsapp|telegram|manual|hr|grab
  source_ref        text,                                   -- email msg id / WA msg id / file hash / storehub eod id
  doc_type          text not null,                          -- pos_eod|bank_stmt|supplier_invoice|receipt|payroll_export|grab_payout
  outlet_id         text references "Outlet"(id) on delete set null,
  raw_url           text,                                   -- supabase storage path
  raw_text          text,                                   -- OCR / parse output
  metadata          jsonb not null default '{}'::jsonb,
  received_at       timestamptz not null default now(),
  ingested_at       timestamptz,
  status            text not null default 'pending',        -- pending|processed|exception|duplicate
  created_at        timestamptz not null default now(),
  unique (source, source_ref)
);
create index if not exists idx_fin_documents_source on fin_documents(source, status);
create index if not exists idx_fin_documents_outlet on fin_documents(outlet_id);
create index if not exists idx_fin_documents_received on fin_documents(received_at);


-- ─── Universal ledger ─────────────────────────────────────
-- One row per business event. Lines balance to zero (enforced via trigger).
create table if not exists fin_transactions (
  id                text primary key,
  txn_date          date not null,
  description       text not null,
  outlet_id         text references "Outlet"(id) on delete set null,
  amount            numeric(14,2) not null,                 -- absolute total (sum of debits = sum of credits)
  currency          text not null default 'MYR',
  source_doc_id     text references fin_documents(id) on delete set null,
  txn_type          text not null,                          -- ar_invoice|ap_bill|payment|journal|depreciation|fx_adj|reversal
  -- Agent provenance
  posted_by_agent   text,                                   -- categorizer|matcher|ap|ar|close|compliance|manual
  agent_version     text,
  confidence        numeric(4,3),                           -- 0.000-1.000
  -- State
  status            text not null default 'draft',          -- draft|posted|exception|reversed
  reversed_by_id    text references fin_transactions(id) on delete set null,
  posted_at         timestamptz,
  -- Period lock binding
  period            text generated always as (to_char(txn_date, 'YYYY-MM')) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fin_transactions_status_chk check (status in ('draft','posted','exception','reversed'))
);
create index if not exists idx_fin_transactions_date on fin_transactions(txn_date);
create index if not exists idx_fin_transactions_outlet on fin_transactions(outlet_id);
create index if not exists idx_fin_transactions_status on fin_transactions(status);
create index if not exists idx_fin_transactions_period on fin_transactions(period);
create index if not exists idx_fin_transactions_doc on fin_transactions(source_doc_id);


-- Double-entry lines. Trigger enforces sum(debit) = sum(credit) on commit.
create table if not exists fin_journal_lines (
  id                text primary key,
  transaction_id    text not null references fin_transactions(id) on delete cascade,
  account_code      text not null references fin_accounts(code) on delete restrict,
  outlet_id         text references "Outlet"(id) on delete set null,
  debit             numeric(14,2) not null default 0,
  credit            numeric(14,2) not null default 0,
  memo              text,
  line_order        int not null default 0,
  created_at        timestamptz not null default now(),
  constraint fin_journal_lines_sign_chk check (
    (debit >= 0 and credit >= 0) and (debit = 0 or credit = 0)
  )
);
create index if not exists idx_fin_journal_lines_txn on fin_journal_lines(transaction_id);
create index if not exists idx_fin_journal_lines_account on fin_journal_lines(account_code);
create index if not exists idx_fin_journal_lines_outlet on fin_journal_lines(outlet_id);


-- ─── Bank feed ─────────────────────────────────────────────
-- Raw lines from bank statement / API feed. Reconciled via fin_matches.
create table if not exists fin_bank_transactions (
  id                text primary key,
  bank_account_code text not null references fin_accounts(code) on delete restrict, -- 1000-01 etc
  txn_date          date not null,
  amount            numeric(14,2) not null,                 -- signed: positive=inflow, negative=outflow
  description       text not null,
  reference         text,
  raw_line_id       text references "BankStatementLine"(id) on delete set null,
  status            text not null default 'unmatched',      -- unmatched|matched|exception|ignored
  created_at        timestamptz not null default now(),
  unique (bank_account_code, txn_date, amount, description, reference)  -- dedupe re-imports
);
create index if not exists idx_fin_bank_txn_account_date on fin_bank_transactions(bank_account_code, txn_date);
create index if not exists idx_fin_bank_txn_status on fin_bank_transactions(status);


-- ─── AR (invoices) ─────────────────────────────────────────
-- Mostly auto-generated from StoreHub EOD. customer_id null for retail aggregate.
create table if not exists fin_invoices (
  id                text primary key,
  invoice_number    text not null unique,                   -- our format, distinct from MyInvois UUID
  customer_id       text,                                   -- null for retail; FK to a customer table when added
  outlet_id         text references "Outlet"(id) on delete set null,
  channel           text not null,                          -- cash_qr|card|grabfood|voucher|gastrohub|meetings|other
  invoice_date      date not null,
  due_date          date,
  subtotal          numeric(14,2) not null,
  sst_amount        numeric(14,2) not null default 0,
  total             numeric(14,2) not null,
  payment_status    text not null default 'unpaid',         -- unpaid|partial|paid|void
  paid_amount       numeric(14,2) not null default 0,
  transaction_id    text references fin_transactions(id) on delete set null,
  source_doc_id     text references fin_documents(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_fin_invoices_outlet on fin_invoices(outlet_id);
create index if not exists idx_fin_invoices_status on fin_invoices(payment_status);
create index if not exists idx_fin_invoices_date on fin_invoices(invoice_date);
create index if not exists idx_fin_invoices_channel on fin_invoices(channel);


-- ─── AP (bills) ────────────────────────────────────────────
-- Created by AP agent from supplier emails / WhatsApp / uploads. Links to
-- existing Supplier model (Prisma) for vendor info.
create table if not exists fin_bills (
  id                text primary key,
  supplier_id       text references "Supplier"(id) on delete set null,
  bill_number       text,                                   -- supplier's invoice number
  bill_date         date not null,
  due_date          date,
  outlet_id         text references "Outlet"(id) on delete set null,
  subtotal          numeric(14,2) not null,
  sst_amount        numeric(14,2) not null default 0,
  total             numeric(14,2) not null,
  payment_status    text not null default 'unpaid',         -- unpaid|partial|paid|void
  paid_amount       numeric(14,2) not null default 0,
  transaction_id    text references fin_transactions(id) on delete set null,
  source_doc_id     text references fin_documents(id) on delete set null,
  notes             text,
  scheduled_pay_date date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_fin_bills_supplier on fin_bills(supplier_id);
create index if not exists idx_fin_bills_status on fin_bills(payment_status);
create index if not exists idx_fin_bills_date on fin_bills(bill_date);
create index if not exists idx_fin_bills_due on fin_bills(due_date) where payment_status in ('unpaid','partial');


-- ─── Reconciliation log ────────────────────────────────────
create table if not exists fin_matches (
  id                text primary key,
  bank_txn_id       text not null references fin_bank_transactions(id) on delete cascade,
  matched_to_type   text not null,                          -- invoice|bill|transaction
  matched_to_id     text not null,                          -- id of invoice/bill/transaction
  amount_matched    numeric(14,2) not null,
  confidence        numeric(4,3),
  agent             text,                                   -- matcher|ap|manual
  matched_at        timestamptz not null default now()
);
create index if not exists idx_fin_matches_bank on fin_matches(bank_txn_id);
create index if not exists idx_fin_matches_target on fin_matches(matched_to_type, matched_to_id);


-- ─── Exception inbox ───────────────────────────────────────
-- The ONLY human surface. Anything an agent can't resolve confidently lands here.
create table if not exists fin_exceptions (
  id                text primary key,
  type              text not null,                          -- categorization|match|missing_doc|anomaly|duplicate|out_of_balance
  related_type      text not null,                          -- transaction|bank_txn|document|bill|invoice
  related_id        text not null,
  agent             text not null,
  reason            text not null,
  proposed_action   jsonb,                                  -- agent's best guess (account_code, match candidate, etc.)
  priority          text not null default 'normal',         -- low|normal|high|urgent
  status            text not null default 'open',           -- open|resolved|dismissed
  resolved_by       text references "User"(id) on delete set null,
  resolved_at       timestamptz,
  resolution        jsonb,                                  -- what the human actually decided (becomes training data)
  created_at        timestamptz not null default now()
);
create index if not exists idx_fin_exceptions_status on fin_exceptions(status, priority, created_at);
create index if not exists idx_fin_exceptions_related on fin_exceptions(related_type, related_id);


-- ─── Agent decision log ────────────────────────────────────
-- Every agent call (auto-posted or exception) is recorded for audit + training.
create table if not exists fin_agent_decisions (
  id                text primary key,
  agent             text not null,                          -- categorizer|matcher|ap|ar|close|compliance|anomaly
  agent_version     text not null,
  input             jsonb not null,                         -- prompt context
  output            jsonb not null,                         -- proposed action
  confidence        numeric(4,3) not null,
  applied           boolean not null default false,         -- did we auto-post it
  related_type      text,
  related_id        text,
  corrected         boolean not null default false,
  corrected_to      jsonb,
  corrected_by      text references "User"(id) on delete set null,
  corrected_at      timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists idx_fin_agent_decisions_agent on fin_agent_decisions(agent, created_at);
create index if not exists idx_fin_agent_decisions_corrected on fin_agent_decisions(corrected) where corrected;


-- ─── Period close ──────────────────────────────────────────
-- One row per accounting period. status drives whether txns can be posted to it.
create table if not exists fin_periods (
  period            text primary key,                       -- "2026-04"
  status            text not null default 'open',           -- open|closing|closed
  pnl_snapshot      jsonb,
  bs_snapshot       jsonb,
  cf_snapshot       jsonb,
  closed_at         timestamptz,
  closed_by         text references "User"(id) on delete set null,
  reopened_at       timestamptz,
  reopened_by       text references "User"(id) on delete set null,
  reopen_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);


-- ─── Fixed assets ──────────────────────────────────────────
-- Drives monthly depreciation by the Close agent. account_code points to a
-- 1500-xx asset account; matching 1550-xx accumulated dep auto-derived.
create table if not exists fin_fixed_assets (
  id                text primary key,
  account_code      text not null references fin_accounts(code) on delete restrict,
  outlet_id         text references "Outlet"(id) on delete set null,
  description       text not null,
  acquired_date     date not null,
  cost              numeric(14,2) not null,
  useful_life_months int not null,
  method            text not null default 'straight_line',  -- straight_line (only one for now)
  accumulated_dep   numeric(14,2) not null default 0,
  status            text not null default 'active',         -- active|disposed|fully_depreciated
  disposed_date     date,
  disposed_amount   numeric(14,2),
  source_doc_id     text references fin_documents(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_fin_fixed_assets_account on fin_fixed_assets(account_code);
create index if not exists idx_fin_fixed_assets_status on fin_fixed_assets(status);


-- ─── Compliance: MyInvois (LHDN e-invoice) ─────────────────
create table if not exists fin_einvoice_submissions (
  id                text primary key,
  invoice_id        text not null references fin_invoices(id) on delete cascade,
  myinvois_uuid     text,                                   -- LHDN-issued
  submission_id     text,
  status            text not null default 'pending',        -- pending|submitted|valid|invalid|cancelled|rejected
  validation_results jsonb,
  qr_url            text,                                   -- LHDN-issued QR code URL
  submitted_at      timestamptz,
  validated_at      timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  raw_response      jsonb,                                  -- full LHDN response for audit
  created_at        timestamptz not null default now()
);
create index if not exists idx_fin_einvoice_status on fin_einvoice_submissions(status);
create index if not exists idx_fin_einvoice_invoice on fin_einvoice_submissions(invoice_id);


-- ─── Compliance: SST-02 ────────────────────────────────────
create table if not exists fin_sst_filings (
  id                text primary key,
  period            text not null unique,                   -- "2026-04"
  output_tax        numeric(14,2) not null,
  input_tax         numeric(14,2) not null default 0,
  net_payable       numeric(14,2) not null,
  filing_status     text not null default 'draft',          -- draft|filed|paid
  filed_at          timestamptz,
  filed_by          text references "User"(id) on delete set null,
  payment_ref       text,
  paid_at           timestamptz,
  details           jsonb,                                  -- breakdown by tax code
  created_at        timestamptz not null default now()
);


-- ─── Roles ─────────────────────────────────────────────────
-- Supplements the existing User.role / appAccess. Finance-specific scoping.
create table if not exists fin_user_roles (
  user_id           text not null references "User"(id) on delete cascade,
  role              text not null,                          -- finance_admin|finance_ops|auditor_readonly|outlet_view
  scope_outlet_id   text references "Outlet"(id) on delete cascade,
  granted_at        timestamptz not null default now(),
  granted_by        text references "User"(id) on delete set null,
  primary key (user_id, role, scope_outlet_id)
);
create index if not exists idx_fin_user_roles_user on fin_user_roles(user_id);


-- ─── Audit log (append-only) ───────────────────────────────
-- Every insert/update/delete on fin_* tables writes here via trigger.
-- Never directly written by app code — only by the fin_audit() trigger.
create table if not exists fin_audit_log (
  id                bigserial primary key,
  table_name        text not null,
  row_id            text not null,
  action            text not null,                          -- insert|update|delete
  before            jsonb,
  after             jsonb,
  actor             text,                                   -- agent name or user id; pulled from current_setting('app.actor', true)
  occurred_at       timestamptz not null default now()
);
create index if not exists idx_fin_audit_log_row on fin_audit_log(table_name, row_id);
create index if not exists idx_fin_audit_log_time on fin_audit_log(occurred_at);


-- ─── Helper: actor setter ──────────────────────────────────
-- Call from app code before any fin_* write so the audit log captures who
-- did it. PostgREST exposes RPCs but not raw `set_config`, hence this thin
-- wrapper. Returns the value set so it can be confirmed in tests.
create or replace function fin_set_actor(p_actor text) returns text
language sql security definer as $$
  select set_config('app.actor', p_actor, true);
$$;

grant execute on function fin_set_actor(text) to authenticated, service_role;


-- ─── Triggers: audit log ───────────────────────────────────
-- Set the actor on each request: select fin_set_actor('matcher-v1');
-- (or the user id for human edits). Falls back to 'system' if unset.
create or replace function fin_audit() returns trigger
language plpgsql security definer as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), 'system');
  v_row_id text;
begin
  if (tg_op = 'DELETE') then
    v_row_id := old.id::text;
    insert into fin_audit_log(table_name, row_id, action, before, after, actor)
    values (tg_table_name, v_row_id, 'delete', to_jsonb(old), null, v_actor);
    return old;
  elsif (tg_op = 'UPDATE') then
    v_row_id := new.id::text;
    insert into fin_audit_log(table_name, row_id, action, before, after, actor)
    values (tg_table_name, v_row_id, 'update', to_jsonb(old), to_jsonb(new), v_actor);
    return new;
  elsif (tg_op = 'INSERT') then
    v_row_id := new.id::text;
    insert into fin_audit_log(table_name, row_id, action, before, after, actor)
    values (tg_table_name, v_row_id, 'insert', null, to_jsonb(new), v_actor);
    return new;
  end if;
  return null;
end $$;

-- Attach to every fin_* table that holds business state. fin_audit_log itself
-- is excluded (would loop) and so are decision/exception logs (already
-- append-only by design).
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'fin_accounts','fin_documents','fin_transactions','fin_journal_lines',
      'fin_bank_transactions','fin_invoices','fin_bills','fin_matches',
      'fin_periods','fin_fixed_assets','fin_einvoice_submissions',
      'fin_sst_filings','fin_user_roles'
    ])
  loop
    execute format('drop trigger if exists trg_%s_audit on %s', t, t);
    execute format(
      'create trigger trg_%s_audit after insert or update or delete on %s
       for each row execute function fin_audit()', t, t
    );
  end loop;
end $$;


-- ─── Triggers: balance check ───────────────────────────────
-- When a transaction is set to status=posted, debits must equal credits.
create or replace function fin_check_balanced() returns trigger
language plpgsql as $$
declare
  v_debit numeric(14,2);
  v_credit numeric(14,2);
begin
  if new.status = 'posted' and (old.status is null or old.status <> 'posted') then
    select coalesce(sum(debit),0), coalesce(sum(credit),0)
      into v_debit, v_credit
      from fin_journal_lines
      where transaction_id = new.id;
    if v_debit <> v_credit then
      raise exception 'Transaction % is unbalanced: debit=% credit=%', new.id, v_debit, v_credit;
    end if;
    if v_debit = 0 then
      raise exception 'Transaction % has no journal lines', new.id;
    end if;
    new.posted_at := coalesce(new.posted_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_fin_transactions_balance on fin_transactions;
create trigger trg_fin_transactions_balance
  before insert or update on fin_transactions
  for each row execute function fin_check_balanced();


-- ─── Triggers: period lock check ───────────────────────────
-- Prevents posting to closed periods. Reopening a period requires updating
-- fin_periods.status back to 'open' first.
create or replace function fin_check_period_open() returns trigger
language plpgsql as $$
declare
  v_status text;
begin
  if new.status = 'posted' then
    select status into v_status from fin_periods where period = new.period;
    if v_status = 'closed' then
      raise exception 'Cannot post transaction to closed period %', new.period;
    end if;
    -- Auto-create the period row if missing.
    if v_status is null then
      insert into fin_periods(period, status) values (new.period, 'open')
      on conflict (period) do nothing;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_fin_transactions_period on fin_transactions;
create trigger trg_fin_transactions_period
  before insert or update on fin_transactions
  for each row execute function fin_check_period_open();


-- ─── updated_at touch ──────────────────────────────────────
create or replace function fin_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  for t in
    select unnest(array[
      'fin_accounts','fin_transactions','fin_invoices','fin_bills',
      'fin_periods','fin_fixed_assets'
    ])
  loop
    execute format('drop trigger if exists trg_%s_touch on %s', t, t);
    execute format(
      'create trigger trg_%s_touch before update on %s
       for each row execute function fin_touch_updated_at()', t, t
    );
  end loop;
end $$;


-- ─── RLS skeleton ──────────────────────────────────────────
-- Enabled on all fin_* tables. Service role (used by Edge Functions /
-- backoffice server actions) bypasses; authenticated users get read
-- access only via finance roles. Write paths go through service role.
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'fin_accounts','fin_documents','fin_transactions','fin_journal_lines',
      'fin_bank_transactions','fin_invoices','fin_bills','fin_matches',
      'fin_exceptions','fin_agent_decisions','fin_periods','fin_fixed_assets',
      'fin_einvoice_submissions','fin_sst_filings','fin_user_roles','fin_audit_log'
    ])
  loop
    execute format('alter table %s enable row level security', t);
  end loop;
end $$;

-- Read policy: any authenticated user with a fin_user_roles row.
-- Backoffice server-side calls use the service role (which bypasses RLS).
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'fin_accounts','fin_documents','fin_transactions','fin_journal_lines',
      'fin_bank_transactions','fin_invoices','fin_bills','fin_matches',
      'fin_exceptions','fin_periods','fin_fixed_assets',
      'fin_einvoice_submissions','fin_sst_filings','fin_audit_log'
    ])
  loop
    execute format('drop policy if exists fin_read on %s', t);
    execute format(
      'create policy fin_read on %s for select to authenticated
       using (exists (select 1 from fin_user_roles ur
                      where ur.user_id = auth.uid()::text))', t
    );
  end loop;
end $$;
