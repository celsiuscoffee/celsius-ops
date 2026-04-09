create extension if not exists "pgcrypto";

-- Orders
create table orders (
  id                   uuid primary key default gen_random_uuid(),
  order_number         text not null unique,
  store_id             text not null,
  status               text not null default 'pending'
                         check (status in ('pending','paid','preparing','ready','completed','failed')),
  payment_method       text not null,
  payment_provider_ref text,
  subtotal             integer not null,   -- in sen (RM * 100)
  sst_amount           integer not null default 0,
  total                integer not null,
  customer_name        text,
  customer_phone       text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Order items
create table order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  product_id   text not null,
  product_name text not null,
  variant_name text,
  unit_price   integer not null,   -- in sen
  quantity     integer not null default 1,
  item_total   integer not null,
  modifiers    jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index idx_orders_store_status on orders(store_id, status);
create index idx_orders_created_at   on orders(created_at desc);
create index idx_order_items_order   on order_items(order_id);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger orders_updated_at
  before update on orders
  for each row execute function update_updated_at();

-- Realtime
alter publication supabase_realtime add table orders;

-- RLS
alter table orders      enable row level security;
alter table order_items enable row level security;

create policy "public insert orders"      on orders      for insert with check (true);
create policy "public read orders"        on orders      for select using (true);
create policy "public insert order_items" on order_items for insert with check (true);
create policy "public read order_items"   on order_items for select using (true);
-- Status updates use service_role key (bypasses RLS) from server routes
