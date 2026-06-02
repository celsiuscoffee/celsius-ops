-- ─────────────────────────────────────────────────────────────────────────
-- POS pairing "agent" — nightly data refresh.
--
-- /api/pos/loyalty/suggest-pairs blends co-purchase, combo, usual, complement
-- and SALES-ROUND signals. Two read precomputed data:
--   • co-purchase  → product_co_purchase_scores (materialized view)
--   • sales round  → app_settings.pair_round_scores  (was empty → signal dead)
--
-- This function recomputes BOTH from the same source the co-purchase view uses
-- (StoreHub "SalesTransaction", resolved to our products by name), so the
-- "sales round" weight finally carries real day-part popularity, and the
-- co-purchase view (which had no schedule) stays fresh. Pure SQL → pg_cron,
-- mirroring refresh_product_co_purchase_scores().
--
-- pair_round_scores shape: { "<round>": { "<product_id>": units, ... }, ... }
-- Rounds use the canonical day-part bands (storehub-helpers ROUNDS, also kept
-- in sync with suggest-pairs/route.ts ROUNDS). transactedAt is stored MYT-local
-- (no tz) so the hour is read directly — same convention as the BO analytics.
-- ─────────────────────────────────────────────────────────────────────────
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
  -- 1) Sales-round popularity: units sold per product per day-part (last 365d).
  WITH txn AS (
    SELECT p.id AS product_id,
           extract(hour FROM s."transactedAt")::int AS h,
           coalesce(s.quantity, 1)                  AS qty
    FROM "SalesTransaction" s
    JOIN products p
      ON lower(btrim(p.name)) = lower(btrim(s."menuName"))
     AND p.brand_id = 'brand-celsius'
     AND p.is_available = true
    WHERE s."transactedAt" > now() - interval '365 days'
  ),
  scored AS (
    SELECT
      CASE
        WHEN h >= 8  AND h < 10 THEN 'breakfast'
        WHEN h >= 10 AND h < 12 THEN 'brunch'
        WHEN h >= 12 AND h < 15 THEN 'lunch'
        WHEN h >= 15 AND h < 17 THEN 'midday'
        WHEN h >= 17 AND h < 19 THEN 'evening'
        WHEN h >= 19 AND h < 21 THEN 'dinner'
        WHEN h >= 21 AND h < 23 THEN 'supper'
        ELSE NULL
      END                AS round,
      product_id,
      sum(qty)::int      AS units
    FROM txn
    GROUP BY 1, 2
  )
  SELECT jsonb_object_agg(round, prod_map) INTO round_scores
  FROM (
    SELECT round, jsonb_object_agg(product_id, units) AS prod_map
    FROM scored
    WHERE round IS NOT NULL
    GROUP BY round
  ) t;

  INSERT INTO app_settings (key, value, updated_at)
  VALUES ('pair_round_scores', coalesce(round_scores, '{}'::jsonb), now())
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();

  -- 2) Co-purchase basket scores — best-effort so a refresh hiccup never blocks
  --    the round-scores write above.
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY product_co_purchase_scores;
  EXCEPTION WHEN OTHERS THEN
    co_ok := false;
  END;

  RETURN jsonb_build_object(
    'pair_round_scores_rounds', (SELECT count(*) FROM jsonb_object_keys(coalesce(round_scores, '{}'::jsonb))),
    'co_purchase_refreshed', co_ok,
    'computed_at', now()
  );
END;
$function$;

-- Nightly at 16:20 UTC = 00:20 MYT (just after the existing daily snapshot job).
SELECT cron.schedule(
  'refresh-pos-pairing-signals',
  '20 16 * * *',
  $$SELECT public.refresh_pos_pairing_signals();$$
);
