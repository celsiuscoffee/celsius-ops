-- Add discount tracking to orders
alter table orders
  add column if not exists discount_amount integer not null default 0,
  add column if not exists voucher_code    text;

-- RPC to atomically increment voucher used_count
create or replace function increment_voucher_count(voucher_id uuid)
returns void
language sql
security definer
as $$
  update vouchers
  set used_count = used_count + 1
  where id = voucher_id;
$$;
