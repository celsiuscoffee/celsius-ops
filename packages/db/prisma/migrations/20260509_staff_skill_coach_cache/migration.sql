-- Cache table for the AI skills-coach. The coach interprets a staff member's
-- audit history (deltas, trends, regressions) and outputs structured insights
-- — strengths, focus areas, suggested coaching actions. We DB-cache so each
-- staff's insights are only re-generated when there's actually new audit data
-- to interpret (cache key = the latest completed STAFF audit's id).
--
-- Anon clients should not read this — RLS blocks them. The endpoint runs with
-- service-role and enforces auth in the route handler.
CREATE TABLE IF NOT EXISTS "staff_skill_coach_cache" (
  "user_id"          TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "latest_audit_id"  TEXT,
  "insights"         JSONB NOT NULL,
  "model"            TEXT,
  "generated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "staff_skill_coach_cache" ENABLE ROW LEVEL SECURITY;
