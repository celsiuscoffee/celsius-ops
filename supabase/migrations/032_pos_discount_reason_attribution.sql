-- Reason-code + attribute every cashier-applied (manual) discount.
--
-- A free-text manual discount with no reason and no name on it is the POS's
-- biggest shrinkage hole: reporting can't tell a legit comp (free review drink,
-- KOL meal, service recovery) from theft. The native register now forces a
-- REASON (from a fixed, capped list) on every manual discount and records WHO
-- authorised it (the manager when a staff used a manager-PIN override, else the
-- cashier). These columns store that audit at the order level (the order-wide
-- manual discount) and the item level (a per-line comp).
--
--   • discount_reason — composed text, e.g. "KOL / influencer · @ammar".
--                       NULL when no manual discount was applied (promo/reward
--                       discounts keep using promo_name / reward_name).
--   • discount_by     — staff/manager id that authorised the discount.
--
-- create_pos_sale is the single, idempotent write path for every POS sale
-- (online + offline drain), so it has to pass the two new fields straight
-- through. This re-creates it as a superset of migration 018 — same order-number
-- hardening + decimal-tolerant casts — with discount_reason/discount_by added to
-- the pos_orders and pos_order_items inserts. Backfill is unnecessary: existing
-- rows simply have NULL (no recorded reason), which the comps report treats as
-- "legacy / unaudited".

ALTER TABLE public.pos_orders
  ADD COLUMN IF NOT EXISTS discount_reason text,
  ADD COLUMN IF NOT EXISTS discount_by     text;

ALTER TABLE public.pos_order_items
  ADD COLUMN IF NOT EXISTS discount_reason text,
  ADD COLUMN IF NOT EXISTS discount_by     text;

CREATE OR REPLACE FUNCTION public.create_pos_sale(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o            jsonb       := p->'order';
  v_order_id   text        := o->>'id';
  v_created_at timestamptz := COALESCE((o->>'created_at')::timestamptz, now());
  v_num        text        := o->>'order_number';
  v_prefix     text;
  v_seq        int;
  v_inserted   integer     := 0;
BEGIN
  IF v_order_id IS NULL OR (o->>'outlet_id') IS NULL THEN
    RAISE EXCEPTION 'create_pos_sale: order.id and order.outlet_id are required';
  END IF;

  -- Idempotent: if this sale already landed (a retry after a slow/lost ack),
  -- do nothing more and don't burn a new order number.
  IF EXISTS (SELECT 1 FROM public.pos_orders WHERE id = v_order_id) THEN
    RETURN jsonb_build_object('order_id', v_order_id, 'created', false,
                             'order_number', (SELECT order_number FROM public.pos_orders WHERE id = v_order_id));
  END IF;

  -- Authoritative order number. Keep the client's number when it's free, but
  -- regenerate a fresh sequential number when it's missing OR collides with a
  -- DIFFERENT order. Offline time-coded numbers (no trailing -<digits>) are
  -- left as-is and excluded from the sequence, so they never reset it.
  v_prefix := regexp_replace(COALESCE(v_num, 'CC-' || (o->>'outlet_id') || '-0'), '-[^-]*$', '');
  IF v_num IS NULL OR EXISTS (
    SELECT 1 FROM public.pos_orders WHERE order_number = v_num AND id <> v_order_id
  ) THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_prefix));
    SELECT COALESCE(MAX(substring(order_number from '[0-9]+$')::int), 0) + 1
      INTO v_seq
      FROM public.pos_orders
     WHERE order_number LIKE v_prefix || '-%'
       AND order_number ~ '-[0-9]+$';
    v_num := v_prefix || '-' || lpad(v_seq::text, 4, '0');
    WHILE EXISTS (SELECT 1 FROM public.pos_orders WHERE order_number = v_num) LOOP
      v_seq := v_seq + 1;
      v_num := v_prefix || '-' || lpad(v_seq::text, 4, '0');
    END LOOP;
  END IF;

  -- Amounts are whole sen. round(numeric)::int tolerates a stray decimal
  -- (a percentage discount that wasn't rounded) instead of throwing on ::int
  -- and silently jamming the offline queue.
  INSERT INTO public.pos_orders (
    id, order_number, outlet_id, register_id, shift_id, employee_id,
    source, order_type, status, table_number, queue_number,
    subtotal, sst_amount, service_charge, discount_amount, discount_reason, discount_by,
    promo_discount, promo_name,
    rounding_amount, total, customer_phone, customer_name, loyalty_phone,
    loyalty_points_earned, reward_id, reward_name, reward_discount_amount,
    voucher_code, loyalty_voucher_id, notes, created_at
  ) VALUES (
    v_order_id, v_num, o->>'outlet_id', o->>'register_id', o->>'shift_id', o->>'employee_id',
    COALESCE(o->>'source','pos'), COALESCE(o->>'order_type','takeaway'), COALESCE(o->>'status','completed'),
    o->>'table_number', o->>'queue_number',
    COALESCE(round((o->>'subtotal')::numeric)::int,0), COALESCE(round((o->>'sst_amount')::numeric)::int,0), COALESCE(round((o->>'service_charge')::numeric)::int,0),
    COALESCE(round((o->>'discount_amount')::numeric)::int,0), o->>'discount_reason', o->>'discount_by',
    COALESCE(round((o->>'promo_discount')::numeric)::int,0), o->>'promo_name',
    COALESCE(round((o->>'rounding_amount')::numeric)::int,0), COALESCE(round((o->>'total')::numeric)::int,0),
    o->>'customer_phone', o->>'customer_name', o->>'loyalty_phone',
    COALESCE(round((o->>'loyalty_points_earned')::numeric)::int,0), o->>'reward_id', o->>'reward_name',
    COALESCE(round((o->>'reward_discount_amount')::numeric)::int,0), o->>'voucher_code', o->>'loyalty_voucher_id', o->>'notes', v_created_at
  )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted > 0 THEN
    INSERT INTO public.pos_order_items (
      id, order_id, product_id, product_name, variant_id, variant_name,
      quantity, unit_price, modifiers, modifier_total, discount_amount, discount_reason, discount_by,
      tax_amount, item_total, notes, kitchen_station, fulfillment, created_at
    )
    SELECT
      COALESCE(it->>'id', gen_random_uuid()::text),
      v_order_id, it->>'product_id', it->>'product_name', it->>'variant_id', it->>'variant_name',
      COALESCE(round((it->>'quantity')::numeric)::int,1), COALESCE(round((it->>'unit_price')::numeric)::int,0),
      COALESCE(it->'modifiers','[]'::jsonb), COALESCE(round((it->>'modifier_total')::numeric)::int,0),
      COALESCE(round((it->>'discount_amount')::numeric)::int,0), it->>'discount_reason', it->>'discount_by',
      COALESCE(round((it->>'tax_amount')::numeric)::int,0),
      COALESCE(round((it->>'item_total')::numeric)::int,0), it->>'notes', it->>'kitchen_station',
      COALESCE(it->>'fulfillment','dine_in'), v_created_at
    FROM jsonb_array_elements(COALESCE(p->'items','[]'::jsonb)) AS it;

    INSERT INTO public.pos_order_payments (
      id, order_id, payment_method, provider, amount, provider_ref, status, created_at
    )
    SELECT
      COALESCE(pay->>'id', gen_random_uuid()::text),
      v_order_id, pay->>'payment_method', pay->>'provider',
      COALESCE(round((pay->>'amount')::numeric)::int,0), pay->>'provider_ref', COALESCE(pay->>'status','completed'), v_created_at
    FROM jsonb_array_elements(COALESCE(p->'payments','[]'::jsonb)) AS pay;
  END IF;

  RETURN jsonb_build_object('order_id', v_order_id, 'created', v_inserted > 0, 'order_number', v_num);
END;
$function$;
