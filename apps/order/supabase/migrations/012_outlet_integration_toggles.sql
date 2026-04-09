-- Per-outlet integration enable/disable toggles
alter table outlet_settings
  add column if not exists rm_enabled     boolean not null default true,
  add column if not exists bukku_enabled  boolean not null default true,
  add column if not exists stripe_enabled boolean not null default true;
