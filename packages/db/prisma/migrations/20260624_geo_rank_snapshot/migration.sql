-- Geogrid local-rank tracking (GBP SEO loop, Phase A).
--
-- One row per (outlet, keyword) geogrid sweep. `cells` is the raw rank field
-- ([{row,col,lat,lng,rank}], rank null = not in the top 20); atrp/solv/
-- oneReachKm are precomputed headline metrics so the backoffice charts trends
-- without re-reducing every cell on each read.
--
-- See docs/database-migrations.md — this file is captured history; apply via
-- Supabase MCP (apply_migration), do NOT prisma migrate deploy.
CREATE TABLE IF NOT EXISTS "GeoRankSnapshot" (
  "id"          TEXT NOT NULL,
  "outletId"    TEXT NOT NULL,
  "keyword"     TEXT NOT NULL,
  "keywordKind" TEXT NOT NULL DEFAULT 'generic',
  "gridSize"    INTEGER NOT NULL,
  "spacingKm"   DOUBLE PRECISION NOT NULL,
  "biasRadiusM" INTEGER NOT NULL,
  "cells"       JSONB NOT NULL,
  "atrp"        DOUBLE PRECISION NOT NULL,
  "solv"        DOUBLE PRECISION NOT NULL,
  "oneReachKm"  DOUBLE PRECISION NOT NULL,
  "foundCells"  INTEGER NOT NULL,
  "totalCells"  INTEGER NOT NULL,
  "capturedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeoRankSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GeoRankSnapshot_outletId_keyword_capturedAt_idx"
  ON "GeoRankSnapshot" ("outletId", "keyword", "capturedAt");

ALTER TABLE "GeoRankSnapshot"
  ADD CONSTRAINT "GeoRankSnapshot_outletId_fkey"
  FOREIGN KEY ("outletId") REFERENCES "Outlet"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lock to the backoffice. The app reads/writes via the direct Prisma
-- connection (service role), which bypasses RLS, so enabling RLS with NO
-- policy simply keeps the anon/authenticated keys out — this table is never
-- touched by a Supabase client. Avoids the "RLS disabled" exposure default.
ALTER TABLE "GeoRankSnapshot" ENABLE ROW LEVEL SECURITY;

