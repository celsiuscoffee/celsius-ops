-- Add loyalty / reward tracking to orders
alter table orders
  add column if not exists loyalty_phone         text,
  add column if not exists loyalty_id            text,
  add column if not exists reward_id             text,
  add column if not exists reward_name           text,
  add column if not exists reward_discount_amount integer not null default 0,
  add column if not exists loyalty_points_earned  integer not null default 0;
