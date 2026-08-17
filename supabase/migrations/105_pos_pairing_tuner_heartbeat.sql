-- Fleet heartbeat for pos_pairing_tuner — the one agent that cannot be reached
-- from TypeScript.
--
-- APPLIED to prod 2026-08-15 on owner instruction (hard rule 6 satisfied), via
-- the Supabase MCP apply_migration path per the db-migration skill. This copy
-- lives in supabase/migrations/ because that is the APPLIED-history trail; the
-- identical file under packages/db/prisma/migrations/ is the never-executed
-- audit trail that CI's migration-guard checks.
--
-- Verified immediately after applying: heartbeat statement present, SECURITY
-- DEFINER retained, search_path still (public, pg_temp), pg_cron job
-- "refresh-pos-pairing-signals" still active. `last_run_at` stays NULL until
-- the next scheduled fire (20 16 * * * UTC) — the function was deliberately NOT
-- invoked by hand to verify, because running it decays product_co_purchase_seed
-- and product_round_seed by 5% and refreshes the matview; a test run would have
-- charged the seeds an extra night of decay.
--
-- Rollback: re-apply the pre-change definition, which is this file minus the
-- "3) Fleet heartbeat" block (md5 of the pre-change pg_get_functiondef output
-- was ebd1e0cc2cbfd62ba66011e2f320b579).
--
-- CONTEXT (loop QA sweep, 2026-08-15 — docs/design/loop-qa-2026-08-15.md).
-- Ten `armed` agents were logging work but never stamping
-- `agent_registry.last_run_at`, so /agents could not tell a healthy-but-quiet
-- loop from a stopped one. Nine were fixed in TypeScript by calling
-- touchAgentRun() on the path that actually runs.
--
-- pos_pairing_tuner is the exception: it has no TypeScript path at all. It runs
-- from pg_cron job 4 (`refresh-pos-pairing-signals`, 20 16 * * *) calling
-- public.refresh_pos_pairing_signals() directly, so the only place to stamp the
-- registry is inside the function itself.
--
-- The body below is the CURRENT definition, taken verbatim from
-- pg_get_functiondef() on 2026-08-15, with exactly ONE addition: the
-- agent_registry UPDATE immediately before RETURN. Nothing else changes —
-- same SECURITY DEFINER, same search_path, same return shape.
--
-- Why before RETURN rather than at the top: the whole point of the heartbeat is
-- "this ran to completion". The matview refresh above it already swallows its
-- own failure into co_ok, so a late stamp still records a run that produced
-- output.
--
-- Verify after applying:
--   SELECT key, last_run_at FROM agent_registry WHERE key = 'pos_pairing_tuner';
--   -- then wait for the 20 16 * * * firing (or SELECT public.refresh_pos_pairing_signals();)
--   -- and confirm last_run_at moved.

CREATE OR REPLACE FUNCTION public.refresh_pos_pairing_signals()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  round_scores jsonb;
  co_ok boolean := true;
BEGIN
  -- 0) Decay the historical seeds ~5%/night so live sales progressively take
  --    over and the StoreHub heritage fades to nothing in ~2 months.
  UPDATE product_co_purchase_seed SET co_count = co_count * 0.95;
  DELETE FROM product_co_purchase_seed WHERE co_count < 1;
  UPDATE product_round_seed SET units = units * 0.95;
  DELETE FROM product_round_seed WHERE units < 1;

  -- 1) Round popularity: native units per product per KL day-part (last 365d,
  --    POS + web/pickup/QR) + the decayed round seed.
  WITH txn AS (
    SELECT oi.product_id,
           extract(hour FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS h,
           coalesce(oi.quantity,1) AS qty
      FROM pos_order_items oi JOIN pos_orders o ON o.id = oi.order_id
      WHERE coalesce(o.status,'') NOT IN ('cancelled','voided','refunded','failed')
        AND oi.product_id IS NOT NULL AND o.created_at > now() - interval '365 days'
    UNION ALL
    SELECT oi.product_id,
           extract(hour FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int,
           coalesce(oi.quantity,1)
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE coalesce(o.status,'') NOT IN ('pending','cancelled','failed','abandoned')
        AND oi.product_id IS NOT NULL AND o.created_at > now() - interval '365 days'
  ),
  native_round AS (
    SELECT CASE
        WHEN h>=8  AND h<10 THEN 'breakfast' WHEN h>=10 AND h<12 THEN 'brunch'
        WHEN h>=12 AND h<15 THEN 'lunch'     WHEN h>=15 AND h<17 THEN 'midday'
        WHEN h>=17 AND h<19 THEN 'evening'   WHEN h>=19 AND h<21 THEN 'dinner'
        WHEN h>=21 AND h<23 THEN 'supper'    ELSE NULL END AS round,
      product_id, sum(qty)::numeric AS units
    FROM txn GROUP BY 1,2
  ),
  blended AS (
    SELECT round, product_id, sum(units) AS units FROM (
      SELECT round, product_id, units FROM native_round WHERE round IS NOT NULL
      UNION ALL
      SELECT round, product_id, units FROM product_round_seed
    ) u GROUP BY round, product_id
  )
  SELECT jsonb_object_agg(round, prod_map) INTO round_scores FROM (
    SELECT round, jsonb_object_agg(product_id, round(units)::int) AS prod_map
    FROM blended WHERE units >= 1 GROUP BY round
  ) t;

  INSERT INTO app_settings (key, value, updated_at)
  VALUES ('pair_round_scores', coalesce(round_scores, '{}'::jsonb), now())
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();

  -- 2) Co-purchase (native baskets + decayed seed) lives in the matview.
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY product_co_purchase_scores;
  EXCEPTION WHEN OTHERS THEN co_ok := false;
  END;

  -- 3) Fleet heartbeat (ADDED 2026-08-15). This function has no TypeScript
  --    caller, so /agents has always shown pos_pairing_tuner as "never ran".
  --    Stamping here is the only way it can tell quiet from stopped.
  UPDATE agent_registry
     SET last_run_at = now(), updated_at = now()
   WHERE key = 'pos_pairing_tuner';

  RETURN jsonb_build_object(
    'source', 'native (pos_order_items + order_items) + decaying seed',
    'pair_round_scores_rounds', (SELECT count(*) FROM jsonb_object_keys(coalesce(round_scores, '{}'::jsonb))),
    'co_purchase_refreshed', co_ok,
    'computed_at', now()
  );
END;
$function$;
