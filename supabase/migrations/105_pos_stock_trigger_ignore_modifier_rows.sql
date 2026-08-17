-- Applied 2026-08-17 via Supabase MCP (apply_migration:
-- pos_stock_trigger_ignore_modifier_rows), owner-approved in session.
-- Audit trail per docs/database-migrations.md - do not re-run.
--
-- HOTFIX. The POS sale-time depletion trigger (pos_order_items_stock_ins →
-- pos_apply_item_stock) summed EVERY MenuIngredient row for the sold menu —
-- no modifier, serviceMode, or replacesProductId logic. Before 2026-08-13
-- that meant double-charging temperature-scoped syrup doses (Iced + Hot on
-- every sale). After the 20260810 BOM migrations added 32 Oatmilk substitution
-- rows and 22 Extra Shot rows, it meant every POS coffee sale depleted 36 g of
-- beans and BOTH milks unconditionally.
--
-- Measured over-depletion 13 Aug 18:50 MYT → 17 Aug: ~7.2 kg beans and ~50 L
-- oat (mostly absorbed by the zero-floor) per outlet. Tamarind's nightly
-- counts reset its balances; Putrajaya / Shah Alam carry the drift until they
-- next count (a count overwrites balances, so no data repair is needed).
--
-- Fix: deplete only unconditional rows (modifier IS NULL). Modifier-scoped
-- ingredients are slightly under-depleted until the consumption engine
-- (modifier-aware via @celsius/db expandSoldLine, both sales channels,
-- audited via StockAdjustment) replaces this trigger entirely — see
-- apps/backoffice/src/lib/inventory/consumption-post.ts.

CREATE OR REPLACE FUNCTION public.pos_apply_item_stock(p_product_id text, p_product_name text, p_outlet_ref text, p_quantity integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      and mi.modifier is null
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
$function$;
