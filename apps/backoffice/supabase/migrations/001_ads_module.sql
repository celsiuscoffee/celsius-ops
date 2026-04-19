-- Ads Module
-- Google Ads performance tracking + invoice/expense management for audit purposes
-- MCC: 415-243-7144, Child account: 890-356-3535, Dev token scope: Explorer Access

-- ─── Accounts ──────────────────────────────────────────────
-- One row per Google Ads customer account we're tracking.
create table if not exists ads_account (
  id                text primary key,
  customer_id       text not null unique,              -- "8903563535" (no dashes)
  descriptive_name  text not null,
  currency_code     text not null default 'MYR',
  time_zone         text not null default 'Asia/Kuala_Lumpur',
  is_manager        boolean not null default false,
  is_test_account   boolean not null default false,
  outlet_id         text references "Outlet"(id) on delete set null,  -- optional single-outlet attribution
  status            text not null default 'ACTIVE',    -- ACTIVE | PAUSED | CANCELLED
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_ads_account_outlet on ads_account(outlet_id);

-- ─── Campaigns ─────────────────────────────────────────────
create table if not exists ads_campaign (
  id                         text primary key,
  campaign_id                text not null,                         -- Google's campaign_id (stringified int64)
  account_id                 text not null references ads_account(id) on delete cascade,
  name                       text not null,
  status                     text not null,                         -- ENABLED | PAUSED | REMOVED
  advertising_channel_type   text not null,                         -- SEARCH | DISPLAY | PERFORMANCE_MAX | LOCAL | VIDEO | SHOPPING
  start_date                 date,
  end_date                   date,
  daily_budget_micros        bigint,                                -- cost_micros format (÷ 1,000,000 = MYR)
  outlet_id                  text references "Outlet"(id) on delete set null,  -- manual campaign→outlet link
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (account_id, campaign_id)
);

create index if not exists idx_ads_campaign_account on ads_campaign(account_id);
create index if not exists idx_ads_campaign_outlet on ads_campaign(outlet_id);
create index if not exists idx_ads_campaign_status on ads_campaign(status);

-- ─── Daily metrics (account + campaign level) ─────────────
-- Account-level rows have campaign_id = NULL (rolled-up totals).
-- Campaign-level rows have campaign_id set.
create table if not exists ads_metric_daily (
  id                text primary key,
  date              date not null,
  account_id        text not null references ads_account(id) on delete cascade,
  campaign_id       text references ads_campaign(id) on delete cascade,  -- nullable for account-level
  impressions       bigint not null default 0,
  clicks            bigint not null default 0,
  conversions       numeric(14,4) not null default 0,                     -- can be fractional (weighted)
  conversions_value numeric(14,4) not null default 0,
  cost_micros       bigint not null default 0,                            -- ÷ 1,000,000 for MYR
  avg_cpc_micros    bigint,
  ctr               numeric(8,6),                                         -- clicks / impressions
  synced_at         timestamptz not null default now(),
  unique (date, account_id, campaign_id)
);

create index if not exists idx_ads_metric_daily_date on ads_metric_daily(date desc);
create index if not exists idx_ads_metric_daily_account on ads_metric_daily(account_id, date desc);
create index if not exists idx_ads_metric_daily_campaign on ads_metric_daily(campaign_id, date desc);

-- ─── Keyword-level metrics (daily, rolling 90d window) ───
-- Optional granularity — only for SEARCH campaigns.
-- Kept lean with rolling retention; older rows pruned by cron.
create table if not exists ads_keyword_metric (
  id            text primary key,
  date          date not null,
  campaign_id   text not null references ads_campaign(id) on delete cascade,
  ad_group_id   text not null,
  criterion_id  text not null,                                          -- keyword criterion_id
  keyword_text  text not null,
  match_type    text not null,                                          -- EXACT | PHRASE | BROAD
  impressions   bigint not null default 0,
  clicks        bigint not null default 0,
  conversions   numeric(14,4) not null default 0,
  cost_micros   bigint not null default 0,
  synced_at     timestamptz not null default now(),
  unique (date, campaign_id, ad_group_id, criterion_id)
);

create index if not exists idx_ads_keyword_date on ads_keyword_metric(date desc);
create index if not exists idx_ads_keyword_campaign on ads_keyword_metric(campaign_id, date desc);

-- ─── Invoices (for claim / audit) ──────────────────────────
create table if not exists ads_invoice (
  id                      text primary key,
  invoice_id              text not null unique,                         -- Google's invoice number
  account_id              text not null references ads_account(id) on delete cascade,
  issue_date              date not null,
  due_date                date,
  billing_period_start    date not null,
  billing_period_end      date not null,
  currency_code           text not null default 'MYR',
  subtotal_micros         bigint not null default 0,
  adjustments_micros      bigint not null default 0,
  regulatory_costs_micros bigint not null default 0,
  tax_micros              bigint not null default 0,                    -- SST
  total_micros            bigint not null default 0,
  status                  text not null,                                -- PAYABLE | PAST_DUE | APPROVED | CANCELLED | etc.
  pdf_source_url          text,                                         -- Google's short-lived URL (for audit reference)
  pdf_storage_path        text,                                         -- path in Supabase Storage
  pdf_hash_sha256         text,                                         -- integrity check
  pdf_size_bytes          integer,
  synced_at               timestamptz not null default now(),
  created_at              timestamptz not null default now()
);

create index if not exists idx_ads_invoice_account on ads_invoice(account_id, issue_date desc);
create index if not exists idx_ads_invoice_period on ads_invoice(billing_period_start desc);
create index if not exists idx_ads_invoice_status on ads_invoice(status);

-- ─── Sync audit log ────────────────────────────────────────
-- Every API sync writes a row — powers debug view + retry logic.
create table if not exists ads_sync_log (
  id              text primary key,
  kind            text not null,                                        -- metrics-daily | metrics-backfill | invoices | keywords | accounts
  account_id      text references ads_account(id) on delete cascade,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'RUNNING',                      -- RUNNING | OK | ERROR
  rows_inserted   integer,
  rows_updated    integer,
  error_message   text,
  metadata        jsonb
);

create index if not exists idx_ads_sync_log_started on ads_sync_log(started_at desc);
create index if not exists idx_ads_sync_log_kind on ads_sync_log(kind, started_at desc);

-- ─── Settings (singleton row pattern) ─────────────────────
-- Single-row table holding module-wide config.
create table if not exists ads_settings (
  id              text primary key default 'singleton',
  mcc_customer_id text,                                                 -- "4152437144"
  daily_sync_enabled    boolean not null default true,
  keyword_sync_enabled  boolean not null default true,
  invoice_sync_enabled  boolean not null default true,
  updated_at      timestamptz not null default now(),
  check (id = 'singleton')
);

insert into ads_settings (id, mcc_customer_id)
values ('singleton', '4152437144')
on conflict (id) do nothing;
