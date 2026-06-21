-- ─────────────────────────────────────────────────────────────────────────
-- Poster deeplink attribution — let the autopilot learn which poster actually
-- drives orders / higher AOV (home + splash app placements).
--
-- The app carousel/splash posters deeplink to /product/<id> or /menu. We log a
-- tap event, then (mirroring push attribution in lib/push/attribution.ts) tag
-- the next order from that member to the most recent unattributed tap within a
-- 24h window. That gives real per-poster taps / orders / AOV — a far stronger
-- signal than the POS switchback. The autopilot blends this measured AOV into
-- its score as data accrues (cold-start = margin heuristic → measured).
--
-- Additive + idempotent.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS poster_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poster_id           text,                          -- splash_posters.id
  product_id          text,                          -- product the deeplink points to (if any)
  placement           text,                          -- 'home' | 'splash' | 'pos-display'
  round               text,
  loyalty_id          text,                          -- member if known at tap time
  session_id          text,                          -- anonymous client fallback
  event_type          text NOT NULL DEFAULT 'tap',   -- 'tap' | 'impression'
  created_at          timestamptz NOT NULL DEFAULT now(),
  attributed_order_id text,
  attributed_revenue  numeric,
  attributed_at       timestamptz
);
COMMENT ON TABLE poster_events IS
  'Poster taps + last-touch order attribution for app posters. Feeds pos-poster-autopilot measured AOV.';

CREATE INDEX IF NOT EXISTS idx_poster_events_attr_lookup
  ON poster_events (loyalty_id, attributed_order_id, created_at) WHERE loyalty_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_poster_events_session_lookup
  ON poster_events (session_id, attributed_order_id, created_at) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_poster_events_poster ON poster_events (poster_id, created_at);

-- Per-poster measured performance over a trailing window: taps, attributed
-- orders, and the AOV of those orders. The autopilot's app learning signal.
CREATE OR REPLACE FUNCTION public.pos_poster_app_perf(p_days integer DEFAULT 28)
RETURNS TABLE(poster_id text, taps bigint, orders bigint, attributed_aov numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT
    poster_id,
    count(*) FILTER (WHERE event_type = 'tap')                  AS taps,
    count(*) FILTER (WHERE attributed_order_id IS NOT NULL)     AS orders,
    round(avg(attributed_revenue) FILTER (WHERE attributed_order_id IS NOT NULL), 2) AS attributed_aov
  FROM poster_events
  WHERE created_at > now() - make_interval(days => p_days)
    AND poster_id IS NOT NULL
  GROUP BY poster_id;
$$;
