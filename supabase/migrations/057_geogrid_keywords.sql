-- 057_geogrid_keywords.sql
-- Tracked keyword set per outlet for the automated geogrid loop. Keywords are
-- auto-selected monthly from the GBP Performance API (the terms customers
-- actually search), branded/navigational terms filtered out. The scan cron
-- runs these on a need-weighted cadence.

CREATE TABLE IF NOT EXISTS "GeoGridKeyword" (
  "id"          text PRIMARY KEY,
  "outletId"    text NOT NULL REFERENCES "Outlet"("id"),
  "keyword"     text NOT NULL,
  "source"      text NOT NULL DEFAULT 'auto',  -- auto | manual
  "impressions" integer,                        -- monthly impressions (importance)
  "active"      boolean NOT NULL DEFAULT true,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("outletId", "keyword")
);

CREATE INDEX IF NOT EXISTS "GeoGridKeyword_outlet_idx" ON "GeoGridKeyword" ("outletId", "active");
