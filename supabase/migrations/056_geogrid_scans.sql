-- 056_geogrid_scans.sql
-- Local-rank geogrid scoreboard for the GBP ranking loop. Each scan runs a
-- grid of simulated searches (Places API) around an outlet for one keyword and
-- records the business's rank at every point. Stored over time so the two loop
-- goals are measurable as a trend: avg rank ↓ (better) and green radius ↑ (rank
-- well farther from the storefront = more prominence/reviews).

CREATE TABLE IF NOT EXISTS "GeoGridScan" (
  "id"           text PRIMARY KEY,
  "outletId"     text NOT NULL REFERENCES "Outlet"("id"),
  "keyword"      text NOT NULL,
  "gridSize"     integer NOT NULL,                 -- N for an N×N grid (e.g. 9)
  "rangeMiles"   double precision NOT NULL,        -- spacing between points, miles
  "centerLat"    double precision NOT NULL,
  "centerLng"    double precision NOT NULL,
  "placeId"      text,                             -- target business Places id
  "status"       text NOT NULL DEFAULT 'complete', -- complete | partial | failed
  "points"       jsonb NOT NULL DEFAULT '[]',      -- [{row,col,lat,lng,rank}] rank null = unranked
  "avgRank"      double precision,                 -- mean rank over ranked points
  "pctTop3"      double precision,                 -- % of points ranking 1-3
  "foundPoints"  integer NOT NULL DEFAULT 0,
  "totalPoints"  integer NOT NULL DEFAULT 0,
  "greenRadiusM" double precision,                 -- farthest point (m) still ranking ≤3
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "createdBy"    text
);

CREATE INDEX IF NOT EXISTS "GeoGridScan_outlet_keyword_idx"
  ON "GeoGridScan" ("outletId", "keyword", "createdAt");
