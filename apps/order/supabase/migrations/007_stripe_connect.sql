-- Stripe Connect per outlet
alter table outlet_settings
  add column if not exists stripe_account_id  text,
  add column if not exists stripe_onboarded   boolean not null default false;
