-- ─────────────────────────────────────────────────────────────────────────
-- POS poster autopilot — auto-rotate customer-display posters to push AOV
--
-- The /api/pos/posters endpoint serves active pos-display posters for the
-- current day-part round. This migration lets a cron (pos-poster-autopilot)
-- score the featured product of each round's posters by AOV-lift (margin +
-- food-attach in drink-heavy rounds + price anchor) and flip active/sort_order
-- to the best K per round. A switchback A/B (autopilot days vs control/
-- popularity days) records per-round AOV in pos_poster_perf so the loop can
-- prove whether posters move AOV — and back off if they don't.
--
-- Additive + idempotent. No drops.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Link each poster to the product it features (for margin/attach scoring).
ALTER TABLE splash_posters ADD COLUMN IF NOT EXISTS product_id TEXT;
COMMENT ON COLUMN splash_posters.product_id IS
  'Product (products.id) this poster features. Drives pos-poster-autopilot AOV scoring.';
CREATE INDEX IF NOT EXISTS idx_splash_posters_product_id
  ON splash_posters (product_id) WHERE product_id IS NOT NULL;

-- 2. Switchback A/B measurement: one row per (date, round) tagged with the mode
--    that was live that day and the realised AOV. Autopilot must earn its keep.
CREATE TABLE IF NOT EXISTS pos_poster_perf (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  perf_date           date NOT NULL,
  round               text NOT NULL,
  mode                text NOT NULL,            -- 'autopilot' | 'control'
  aov_rm              numeric,
  orders              integer,
  featured_product_ids text[],
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (perf_date, round)
);
COMMENT ON TABLE pos_poster_perf IS
  'Daily per-round AOV tagged by autopilot/control mode — the holdout that tells us if posters lift AOV.';

-- 3. Gated off by default; flip to {"enabled": true} to go live.
INSERT INTO app_settings (key, value, updated_at)
VALUES ('pos_poster_autopilot_enabled', '{"enabled": false}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

-- 4. Scoring signals: per-round AOV / single-item rate + per-round-per-product
--    units over a trailing window. One call, returned as JSONB.
CREATE OR REPLACE FUNCTION public.pos_poster_signals(p_days integer DEFAULT 21)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH o AS (
    SELECT id, total,
      CASE
        WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 8 AND 9   THEN 'breakfast'
        WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 10 AND 11  THEN 'brunch'
        WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 12 AND 14  THEN 'lunch'
        WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 15 AND 16  THEN 'midday'
        WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 17 AND 18  THEN 'evening'
        WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 19 AND 20  THEN 'dinner'
        WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 21 AND 22  THEN 'supper'
        ELSE 'other'
      END AS rnd
    FROM pos_orders
    WHERE created_at > now() - make_interval(days => p_days)
      AND status NOT IN ('cancelled','refunded','void')
      AND coalesce(refund_of_order_id,'') = ''
  ),
  units AS (SELECT order_id, sum(quantity) AS q FROM pos_order_items GROUP BY order_id),
  round_aov AS (
    SELECT o.rnd,
           count(*) AS orders,
           round(avg(o.total)/100.0, 2) AS aov,
           round(100.0 * sum(CASE WHEN u.q = 1 THEN 1 ELSE 0 END) / count(*), 1) AS single_rate
    FROM o JOIN units u ON u.order_id = o.id
    WHERE o.rnd <> 'other'
    GROUP BY o.rnd
  ),
  prod AS (
    SELECT o.rnd, oi.product_id, sum(oi.quantity) AS units
    FROM o JOIN pos_order_items oi ON oi.order_id = o.id
    WHERE o.rnd <> 'other' AND oi.product_id IS NOT NULL
    GROUP BY o.rnd, oi.product_id
  )
  SELECT jsonb_build_object(
    'rounds',   (SELECT coalesce(jsonb_object_agg(rnd, jsonb_build_object('orders', orders, 'aov', aov, 'single_rate', single_rate)), '{}'::jsonb) FROM round_aov),
    'products', (SELECT coalesce(jsonb_agg(jsonb_build_object('round', rnd, 'product_id', product_id, 'units', units)), '[]'::jsonb) FROM prod)
  );
$$;

-- 5. Realised AOV per round for a specific MYT calendar date (perf logging).
CREATE OR REPLACE FUNCTION public.pos_round_aov_for_date(p_date date)
RETURNS TABLE(round text, orders integer, aov_rm numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE
      WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 8 AND 9   THEN 'breakfast'
      WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 10 AND 11  THEN 'brunch'
      WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 12 AND 14  THEN 'lunch'
      WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 15 AND 16  THEN 'midday'
      WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 17 AND 18  THEN 'evening'
      WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 19 AND 20  THEN 'dinner'
      WHEN extract(hour FROM created_at AT TIME ZONE 'Asia/Kuala_Lumpur') BETWEEN 21 AND 22  THEN 'supper'
      ELSE 'other'
    END AS round,
    count(*)::int AS orders,
    round(avg(total)/100.0, 2) AS aov_rm
  FROM pos_orders
  WHERE (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date = p_date
    AND status NOT IN ('cancelled','refunded','void')
    AND coalesce(refund_of_order_id,'') = ''
  GROUP BY 1;
$$;
