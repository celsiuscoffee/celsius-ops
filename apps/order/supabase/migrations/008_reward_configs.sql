-- Reward discount configurations
-- Maps loyalty app reward IDs to discount structures
create table reward_configs (
  reward_id      text primary key,
  discount_type  text not null check (discount_type in ('flat', 'percent', 'free_item', 'bogo')),
  discount_value integer,   -- sen for flat (e.g. 500 = RM5), integer for percent (e.g. 10 = 10%), null for free_item/bogo
  updated_at     timestamptz not null default now()
);

-- RLS: writes via service role (admin), reads public
alter table reward_configs enable row level security;
create policy "public read reward_configs" on reward_configs for select using (true);
