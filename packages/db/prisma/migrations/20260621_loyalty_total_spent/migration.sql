-- Loyalty: maintain member_brands.total_spent on the per-order earn path.
--
-- Bug: add_loyalty_points (the RPC both the pickup app AND the POS-native till
-- call) incremented points + visits but NEVER total_spent. Only the legacy
-- backoffice award route wrote spend directly. So any member whose spend came
-- through pickup/POS-native showed SPENT = RM0 (e.g. member-1782005742724-00ev:
-- RM45.70 of completed pickup orders, total_spent 0.00).
--
-- Fix: add p_spend (net RM, default 0) and increment total_spent by it. Both
-- callers (apps/order earnLoyaltyPoints, apps/backoffice pos/loyalty/complete)
-- pass the order's net amount (total - sst). Applied via Supabase MCP; this file
-- is the captured history per docs/database-migrations.md. Paired with a one-time
-- backfill of total_spent from real orders + pos_orders.

DROP FUNCTION IF EXISTS public.add_loyalty_points(text, text, integer, text, text, numeric, text);

CREATE OR REPLACE FUNCTION public.add_loyalty_points(
  p_member_id text,
  p_brand_id text,
  p_points integer,
  p_outlet_id text,
  p_order_id text,
  p_multiplier numeric DEFAULT NULL::numeric,
  p_description text DEFAULT 'Points earned'::text,
  p_spend numeric DEFAULT 0           -- net RM (total - SST) for this order
)
 RETURNS TABLE(new_balance integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_balance integer;
BEGIN
  IF p_points <= 0 THEN
    SELECT points_balance INTO v_balance
    FROM public.member_brands
    WHERE member_id = p_member_id AND brand_id = p_brand_id;
    IF v_balance IS NULL THEN v_balance := 0; END IF;
    RETURN QUERY SELECT v_balance;
    RETURN;
  END IF;

  -- Atomic increment — no OCC, just an UPDATE. Concurrent earns
  -- serialise at the row level.
  UPDATE public.member_brands
  SET points_balance      = points_balance      + p_points,
      total_points_earned = total_points_earned + p_points,
      total_visits        = total_visits        + 1,
      total_spent         = total_spent         + GREATEST(COALESCE(p_spend, 0), 0),
      last_visit_at       = now()
  WHERE member_id = p_member_id AND brand_id = p_brand_id
  RETURNING points_balance INTO v_balance;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'member_brand_not_found';
  END IF;

  INSERT INTO public.point_transactions (
    id, member_id, brand_id, outlet_id, type, points, balance_after,
    description, reference_id, multiplier
  ) VALUES (
    'txn-earn-' || extract(epoch from now())::bigint || '-' || substr(md5(random()::text), 1, 8),
    p_member_id, p_brand_id, p_outlet_id, 'earn', p_points, v_balance,
    p_description, p_order_id, p_multiplier
  );

  RETURN QUERY SELECT v_balance;
END;
$function$;

-- ── One-time backfill (run once via Supabase MCP) ───────────────────────────
-- Repairs the historical undercount. total_spent = GREATEST(stored, native_net)
-- so it NEVER lowers a value (legacy StoreHub customer-import lifetime spend has
-- no per-member transaction source and can't be regenerated — must be preserved)
-- and NEVER overstates (native_net is demonstrable real spend from our orders).
-- Net = (total − SST)/100, matching evaluate_member_tier's "real spend" basis.
-- Updated ~427 undercounted members (incl. all pickup-only ones).
WITH native AS (
  SELECT member_id, SUM(net) AS net_rm FROM (
    SELECT loyalty_id AS member_id, GREATEST(total - COALESCE(sst_amount,0),0)/100.0 AS net
    FROM orders WHERE loyalty_id IS NOT NULL AND status IN ('completed','paid','preparing','ready')
    UNION ALL
    SELECT m.id, GREATEST(po.total - COALESCE(po.sst_amount,0),0)/100.0
    FROM pos_orders po JOIN members m ON m.phone = po.loyalty_phone
    WHERE po.loyalty_phone IS NOT NULL AND po.status = 'completed'
  ) r GROUP BY member_id
)
UPDATE member_brands mb
SET total_spent = ROUND(GREATEST(mb.total_spent, n.net_rm), 2)
FROM native n
WHERE mb.member_id = n.member_id AND n.net_rm > mb.total_spent + 0.005;
