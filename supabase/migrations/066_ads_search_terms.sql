-- 066_ads_search_terms.sql
-- Paid×Organic consolidation for the local-rank loop.
--
-- ads_search_term_daily: per-day spend for the actual search terms Smart
-- campaigns matched (smart_campaign_search_term_view) — the missing keyword-
-- level cost data (ads_keyword_metric stays empty for Smart campaigns).
--
-- ads_term_exclusion: the APPROVAL LEDGER for excluding a term from a Smart
-- campaign (negative keyword theme). Rows are only ever created by an explicit
-- human decision in the backoffice; the Google Ads mutation fires on approval,
-- never automatically.

CREATE TABLE IF NOT EXISTS ads_search_term_daily (
  id          text PRIMARY KEY,
  date        date NOT NULL,
  campaign_id text NOT NULL REFERENCES ads_campaign(id) ON DELETE CASCADE,
  search_term text NOT NULL,
  impressions bigint NOT NULL DEFAULT 0,
  clicks      bigint NOT NULL DEFAULT 0,
  cost_micros bigint NOT NULL DEFAULT 0,
  synced_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, campaign_id, search_term)
);

CREATE INDEX IF NOT EXISTS ads_search_term_daily_campaign_idx
  ON ads_search_term_daily (campaign_id, date DESC);
CREATE INDEX IF NOT EXISTS ads_search_term_daily_term_idx
  ON ads_search_term_daily (search_term, date DESC);

CREATE TABLE IF NOT EXISTS ads_term_exclusion (
  id                 text PRIMARY KEY,
  campaign_id        text NOT NULL REFERENCES ads_campaign(id) ON DELETE CASCADE,
  search_term        text NOT NULL,
  status             text NOT NULL, -- applied | failed | rejected
  est_monthly_saving_myr numeric(12,2),
  reason             text,          -- the organic evidence at decision time
  criterion_resource text,          -- Google Ads campaign criterion resource name (for undo)
  error              text,
  decided_by         text,
  decided_at         timestamptz NOT NULL DEFAULT now(),
  applied_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, search_term)
);
