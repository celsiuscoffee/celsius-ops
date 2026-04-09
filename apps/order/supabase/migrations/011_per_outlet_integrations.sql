-- Per-outlet Revenue Monster + Bukku credentials
alter table outlet_settings
  add column if not exists rm_merchant_id   text,
  add column if not exists rm_client_id     text,
  add column if not exists rm_client_secret text,
  add column if not exists rm_private_key   text,
  add column if not exists rm_is_production boolean not null default false,
  add column if not exists bukku_token      text,
  add column if not exists bukku_subdomain  text;
