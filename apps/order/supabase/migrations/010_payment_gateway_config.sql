-- Payment gateway configuration per payment method
create table if not exists payment_gateway_config (
  method_id   text primary key,               -- fpx | tng | grabpay | boost | card | apple_pay | google_pay
  enabled     boolean not null default false,
  provider    text    not null default 'stripe', -- stripe | revenue_monster
  updated_at  timestamptz not null default now()
);

-- Default config
insert into payment_gateway_config (method_id, enabled, provider) values
  ('fpx',        true,  'revenue_monster'),
  ('tng',        true,  'revenue_monster'),
  ('grabpay',    true,  'revenue_monster'),
  ('boost',      true,  'revenue_monster'),
  ('card',       true,  'stripe'),
  ('apple_pay',  true,  'stripe'),
  ('google_pay', true,  'stripe')
on conflict (method_id) do nothing;

alter table payment_gateway_config enable row level security;
create policy "service role full access payment_gateway_config"
  on payment_gateway_config for all using (true);
