-- POS inventory depletion driven by the existing Menu Bill-of-Materials.
--
-- Applied to the live project (kqdcdhpnyuwrxqhbuyfl) as migrations:
--   drop_product_recipes_catalog_bom
--   menu_bom_stock_depletion_triggers
--   lock_down_pos_stock_trigger_functions
--
-- Replaces the earlier catalog-keyed product_recipes BOM. Depletion now reads
-- the maintained MenuIngredient BOM and runs entirely in the database via
-- triggers, so every channel that writes pos_order_items (register, refund,
-- online) keeps stock in sync with no application wiring.
--
-- Linkage chain (no storehub_product_id needed — catalog and Menu share names
-- 1:1 in this dataset, verified):
--   pos_order_items.product_id ──▶ products.name ──(case-insensitive)──▶ Menu
--   ──▶ MenuIngredient ──▶ Product (ingredient) ──▶ StockBalance
--
-- Behaviour:
--   * Sale  (positive qty insert)  → deplete each BOM ingredient.
--   * Refund (negative qty insert) → restore via sign (refund route inserts
--     negative-quantity rows).
--   * Void  (pos_orders.status → 'cancelled') → restore the order's lines.
--   * Stock is clamped at zero; a deplete against a missing base row is a
--     no-op, a restore seeds a base row.
--   * Outlet bridge: pos_orders.outlet_id is the loyalty id, mapped to the
--     inventory Outlet via Outlet.loyaltyOutletId (fallback Outlet.id).

-- ── 1. Drop the superseded catalog BOM table ────────────────────────────────
drop table if exists public.product_recipes cascade;

-- ── 2. Core helper: apply the signed BOM delta for one order line ───────────
-- p_quantity > 0 → sale (deplete); p_quantity < 0 → refund row (restore).
-- The void trigger calls this with a negated quantity to reverse a sale.
create or replace function public.pos_apply_item_stock(
  p_product_id   text,
  p_product_name text,
  p_outlet_ref   text,
  p_quantity     integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outlet_id text;
  v_name      text;
  v_menu_id   text;
  v_delta     numeric;
  r           record;
begin
  if p_quantity is null or p_quantity = 0 then
    return;
  end if;

  select id into v_outlet_id from "Outlet" where "loyaltyOutletId" = p_outlet_ref limit 1;
  if v_outlet_id is null then
    select id into v_outlet_id from "Outlet" where id = p_outlet_ref limit 1;
  end if;
  if v_outlet_id is null then
    return;
  end if;

  select p.name into v_name from products p where p.id = p_product_id;
  v_name := coalesce(v_name, p_product_name);
  if v_name is null or btrim(v_name) = '' then
    return;
  end if;

  select m.id into v_menu_id
  from "Menu" m
  where lower(btrim(m.name)) = lower(btrim(v_name))
  order by m."isActive" desc, m."updatedAt" desc
  limit 1;
  if v_menu_id is null then
    return;
  end if;

  for r in
    select mi."productId" as ingredient_id, mi."quantityUsed" as qty_used
    from "MenuIngredient" mi
    where mi."menuId" = v_menu_id
  loop
    v_delta := -(r.qty_used * p_quantity);
    if v_delta = 0 then
      continue;
    end if;

    update "StockBalance"
       set quantity      = greatest(0, quantity + v_delta),
           "lastUpdated" = now()
     where id = (
       select id from "StockBalance"
        where "outletId"  = v_outlet_id
          and "productId" = r.ingredient_id
          and "productPackageId" is null
        order by "lastUpdated" desc
        limit 1
     );

    if not found and v_delta > 0 then
      insert into "StockBalance"(id, "outletId", "productId", "productPackageId", quantity, "lastUpdated")
      values ('sb-' || replace(gen_random_uuid()::text, '-', ''),
              v_outlet_id, r.ingredient_id, null, v_delta, now());
    end if;
  end loop;
end;
$$;

-- ── 3. INSERT trigger: sales deplete, negative-qty refund rows restore ──────
create or replace function public.trg_pos_order_item_stock() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outlet_ref text;
begin
  select outlet_id into v_outlet_ref from pos_orders where id = NEW.order_id;
  if v_outlet_ref is null then
    return NEW;
  end if;
  perform public.pos_apply_item_stock(NEW.product_id, NEW.product_name, v_outlet_ref, NEW.quantity);
  return NEW;
end;
$$;

drop trigger if exists pos_order_items_stock_ins on public.pos_order_items;
create trigger pos_order_items_stock_ins
  after insert on public.pos_order_items
  for each row execute function public.trg_pos_order_item_stock();

-- ── 4. Void trigger: restore the order's lines on transition to 'cancelled' ─
create or replace function public.trg_pos_order_cancel_restore() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  it record;
begin
  if NEW.status = 'cancelled' and coalesce(OLD.status, '') <> 'cancelled' then
    for it in
      select product_id, product_name, quantity
      from pos_order_items
      where order_id = NEW.id
    loop
      perform public.pos_apply_item_stock(it.product_id, it.product_name, NEW.outlet_id, -it.quantity);
    end loop;
  end if;
  return NEW;
end;
$$;

drop trigger if exists pos_orders_cancel_restore on public.pos_orders;
create trigger pos_orders_cancel_restore
  after update of status on public.pos_orders
  for each row execute function public.trg_pos_order_cancel_restore();

-- ── 5. Lock down: trigger-only functions must not be REST/RPC-callable ──────
-- (Supabase linter 0028/0029 — close the SECURITY DEFINER escalation surface.)
revoke execute on function public.pos_apply_item_stock(text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.trg_pos_order_item_stock() from public, anon, authenticated;
revoke execute on function public.trg_pos_order_cancel_restore() from public, anon, authenticated;
