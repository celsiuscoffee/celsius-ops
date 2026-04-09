-- Web Push subscriptions
create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  order_id   text,                          -- optional: subscribe in context of an order
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- RLS: server-side only
alter table push_subscriptions enable row level security;
-- All access via service_role key (API routes)
