-- Reviews: Nearby Competitor Ranking cache.
--
-- The Reviews module shows where each outlet ranks among the cafés around it
-- (rating + review volume), sourced from Google Places API (New) Nearby Search.
-- Places calls cost money and competitor numbers barely move day-to-day, so we
-- never call Places on dashboard load — a daily cron writes one snapshot per
-- outlet here and the dashboard reads the cache.
--
-- One current row per outlet (unique outletId, upserted by the cron). Applied
-- via Supabase MCP; this file is the captured history per
-- docs/database-migrations.md. Table + column names are PascalCase/camelCase to
-- match the Prisma model CompetitorSnapshot (read through `prisma` in the
-- dashboard route, same as ReviewSettings).

CREATE TABLE IF NOT EXISTS public."CompetitorSnapshot" (
  "id"              text PRIMARY KEY,
  "outletId"        text NOT NULL UNIQUE REFERENCES public."Outlet"("id") ON DELETE CASCADE,
  "capturedAt"      timestamptz NOT NULL DEFAULT now(),
  "radiusM"         integer NOT NULL,
  "selfFound"       boolean NOT NULL DEFAULT false,
  "selfPlaceId"     text,
  "selfRating"      double precision,
  "selfReviewCount" integer,
  "rankByReviews"   integer,
  "rankByRating"    integer,
  "totalNearby"     integer NOT NULL DEFAULT 0,
  "competitors"     jsonb NOT NULL DEFAULT '[]'::jsonb,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now()
);

-- Non-sensitive (public competitor ratings), but locked by default: only the
-- service-role / Prisma direct connection reads it. No PostgREST/anon policies.
ALTER TABLE public."CompetitorSnapshot" ENABLE ROW LEVEL SECURITY;
