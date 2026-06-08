-- Safety net for in-store (register) loyalty: re-award any completed pos_orders
-- that carry a loyalty phone but never got their Beans (e.g. an OFFLINE sale
-- whose deferred /api/pos/loyalty/complete hook was lost on reconnect). Fully
-- idempotent: skips orders that already have an 'earn' txn, and never inserts a
-- second mystery drop for an order. Resolves the member by national
-- significant number (so +60 / 60 / 0 phone formats all match), mirroring the
-- route's gate + points formula. Driven every 5 min by
-- /api/cron/pos-loyalty-reconcile (apps/backoffice).
CREATE OR REPLACE FUNCTION public.reconcile_pos_loyalty(p_since_hours int DEFAULT 24)
RETURNS TABLE(orders_fixed int, points_awarded int, drops_created int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ppr numeric;
  r record;
  v_member text;
  v_tier_mul numeric;
  v_pts int;
  v_pool record;
  v_orders int := 0;
  v_points int := 0;
  v_drops int := 0;
BEGIN
  SELECT coalesce((value->>'rate')::numeric, 1) INTO v_ppr FROM app_settings WHERE key = 'points_per_rm';
  IF v_ppr IS NULL THEN v_ppr := 1; END IF;

  FOR r IN
    SELECT o.id, o.outlet_id, o.total, o.sst_amount, o.loyalty_phone
    FROM pos_orders o
    WHERE o.status = 'completed'
      AND o.loyalty_phone IS NOT NULL
      AND coalesce(o.source, 'pos') <> 'grabfood'   -- in-store register sales only
      AND o.created_at >= now() - make_interval(hours => p_since_hours)
      AND NOT EXISTS (SELECT 1 FROM point_transactions pt WHERE pt.reference_id = o.id AND pt.type = 'earn')
  LOOP
    SELECT m.id, coalesce(t.multiplier, 1)
      INTO v_member, v_tier_mul
    FROM members m
    LEFT JOIN member_brands mb ON mb.member_id = m.id AND mb.brand_id = 'brand-celsius'
    LEFT JOIN tiers t ON t.id = mb.current_tier_id
    WHERE regexp_replace(m.phone, '\D', '', 'g') = regexp_replace(r.loyalty_phone, '\D', '', 'g')
    ORDER BY m.id
    LIMIT 1;

    IF v_member IS NULL THEN CONTINUE; END IF;

    v_orders := v_orders + 1;

    v_pts := round(floor((greatest(0, coalesce(r.total, 0) - coalesce(r.sst_amount, 0)) / 100.0) * v_ppr) * v_tier_mul);
    IF v_pts > 0 THEN
      PERFORM add_loyalty_points(v_member, 'brand-celsius', v_pts, coalesce(r.outlet_id, ''), r.id, v_tier_mul, 'Points earned for in-store order (reconcile)');
      UPDATE pos_orders SET loyalty_points_earned = v_pts WHERE id = r.id;
      PERFORM evaluate_member_tier(v_member, 'brand-celsius');
      v_points := v_points + v_pts;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM mystery_drops WHERE order_id = r.id::uuid) THEN
      SELECT id, outcome_type, multiplier_value, flat_beans_value INTO v_pool
      FROM mystery_pool
      WHERE brand_id = 'brand-celsius' AND is_active = true AND min_tier IS NULL
      ORDER BY random() ^ (1.0 / weight) DESC
      LIMIT 1;
      IF v_pool.id IS NOT NULL THEN
        INSERT INTO mystery_drops (member_id, order_id, pool_entry_id, outcome_type, multiplier_applied, beans_awarded, voucher_id, created_at)
        VALUES (
          v_member, r.id::uuid, v_pool.id, v_pool.outcome_type,
          CASE WHEN v_pool.outcome_type = 'beans_multiplier' THEN v_pool.multiplier_value END,
          CASE WHEN v_pool.outcome_type = 'flat_beans' THEN v_pool.flat_beans_value END,
          NULL, now()
        );
        v_drops := v_drops + 1;
      END IF;
    END IF;
  END LOOP;

  orders_fixed := v_orders; points_awarded := v_points; drops_created := v_drops;
  RETURN NEXT;
END $$;
