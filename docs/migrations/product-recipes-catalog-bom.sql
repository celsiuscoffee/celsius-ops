-- Catalog-keyed Bill of Materials.
-- Applied to the live project (kqdcdhpnyuwrxqhbuyfl) as migration
-- `create_product_recipes_catalog_bom`.
--
-- Links a catalog product (public.products) to the inventory ingredients
-- (public."Product") it consumes per unit sold. POS sales deplete
-- StockBalance through these rows; refunds and voids restore them.
--
-- quantity_used is expressed in `uom`, which the editor pins to the
-- ingredient's baseUom so depletion needs no unit conversion.

create table if not exists public.product_recipes (
  id            text primary key default gen_random_uuid()::text,
  product_id    text not null references public.products(id) on delete cascade,
  ingredient_id text not null references public."Product"(id),
  quantity_used numeric(12,4) not null check (quantity_used > 0),
  uom           text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, ingredient_id)
);

create index if not exists product_recipes_product_id_idx    on public.product_recipes(product_id);
create index if not exists product_recipes_ingredient_id_idx on public.product_recipes(ingredient_id);

-- Service-role only. Anon/authenticated have no policy => no access.
alter table public.product_recipes enable row level security;
