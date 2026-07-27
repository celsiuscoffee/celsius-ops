-- Applied 2026-07-16 via Supabase MCP (apply_migration: consumption_shadow_runs),
-- human in session. Audit trail per docs/database-migrations.md - do not re-run.
--
-- Persist the consumption engine's daily SHADOW computation so it can be
-- validated over time and eventually trusted enough to arm. Today the engine
-- runs daily and computes what each outlet's sales x recipe would deplete, but
-- the result is thrown away (transient HTTP response + console.log). This table
-- keeps one row per outlet per day: what it WOULD deplete, how many menus still
-- lack a recipe (the coverage gap), and whether it actually posted (once armed).
--
-- This is PURE TELEMETRY - it never touches StockAdjustment or StockBalance.
-- Arming the real inventory writes stays gated on CONSUMPTION_ENGINE_ENABLED and
-- the two documented blockers (base-UOM normalisation + a recipe/BOM importer).
-- Server-only, RLS deny-all like the other agent_* / substrate tables.

create table if not exists consumption_shadow_runs (
  id uuid primary key default gen_random_uuid(),
  date date not null,                               -- the MYT sales day computed
  outlet_id text not null,
  outlet_name text,
  mode text not null default 'shadow',              -- shadow | live
  posted boolean not null default false,            -- true only once armed and it wrote
  menus_sold int not null default 0,
  menus_without_recipe int not null default 0,       -- the coverage gap to close before arming
  items_unmapped numeric(12,3) not null default 0,
  products_consumed int not null default 0,
  lines jsonb not null default '[]'::jsonb,         -- [{productId, productName, baseUom, quantity}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, outlet_id)
);
alter table consumption_shadow_runs enable row level security;
create index if not exists consumption_shadow_runs_date_idx on consumption_shadow_runs (date desc);
create index if not exists consumption_shadow_runs_outlet_idx on consumption_shadow_runs (outlet_id, date desc);
