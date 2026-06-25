-- 058_geogrid_competitors.sql
-- Store the competitor leaderboard captured during a scan (who out-ranks us
-- across the grid) for reference: [{name, top3Points, avgRank}].

ALTER TABLE "GeoGridScan"
  ADD COLUMN IF NOT EXISTS "competitors" jsonb NOT NULL DEFAULT '[]';
