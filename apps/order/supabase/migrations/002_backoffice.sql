-- Product availability overrides (86 button)
create table product_overrides (
  product_id   text primary key,
  is_available boolean not null default true,
  updated_at   timestamptz not null default now()
);

-- Per-outlet settings
create table outlet_settings (
  store_id         text primary key,
  is_open          boolean not null default true,
  is_busy          boolean not null default false,
  pickup_time_mins integer not null default 10,
  updated_at       timestamptz not null default now()
);

-- Vouchers / promo codes
create table vouchers (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  description    text,
  discount_type  text not null check (discount_type in ('percent', 'flat')),
  discount_value integer not null,   -- % or sen
  min_order_sen  integer not null default 0,
  max_uses       integer,            -- null = unlimited
  used_count     integer not null default 0,
  is_active      boolean not null default true,
  expires_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- RLS: service role manages these (admin backoffice uses service key)
alter table product_overrides enable row level security;
alter table outlet_settings    enable row level security;
alter table vouchers           enable row level security;

create policy "public read product_overrides" on product_overrides for select using (true);
create policy "public read outlet_settings"   on outlet_settings   for select using (true);
create policy "public read vouchers"          on vouchers          for select using (true);
-- Writes go through server-side API routes using service_role key

-- Seed default outlet settings
insert into outlet_settings (store_id, pickup_time_mins) values
  ('shah-alam', 7),
  ('conezion',  10),
  ('tamarind',  5)
on conflict (store_id) do nothing;
