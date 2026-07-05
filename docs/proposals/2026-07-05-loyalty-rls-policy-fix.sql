-- ⚠️ SUPERSEDED 2026-07-05 — NOT NEEDED. Live-DB verification (pg_policies,
-- role_table_grants on project kqdcdhpnyuwrxqhbuyfl) showed production had
-- already drifted AHEAD of the repo migrations: the USING(true) "Service
-- full access" policies no longer exist, anon's DML grants on the sensitive
-- tables were already revoked (permission denied before RLS even applies),
-- and staff_users was dropped entirely. The real live exposure was the
-- `outlets` VIEW instead — fixed in
-- supabase/migrations/073_revoke_anon_writes_outlets_view.sql.
-- Kept for the record of what the repo's migration files (wrongly) implied.
-- Lesson: audit the live DB, not migration files (STATE.md 2026-07-05).
--
-- Original header follows.
--
-- PROPOSAL — NOT APPLIED. Requires human approval (CLAUDE.md hard rule 6)
-- and must ship AFTER the pickup dashboard-stats API route is deployed
-- (the page's browser reads move server-side in the same PR as this file).
--
-- Target: the LOYALTY Supabase project (kqdcdhpnyuwrxqhbuyfl) — the one
-- apps/order and lib/pickup point at. Not the main project.
--
-- Problem (docs/rls-access-map-2026-07-05.md, exposure 1 — and wider than
-- the map first said): apps/order/supabase/migrations/001_initial_schema.sql
-- creates "Service full access <table>" policies as
--   FOR ALL USING (true) WITH CHECK (true)
-- with no TO clause, so they apply to EVERY role including anon. That
-- makes members, member_brands, point_transactions, redemptions — and
-- also staff_users and otp_codes (staff credentials + login codes) —
-- readable AND writable with the published anon key.
--
-- Fix: drop the ten policies outright. service_role bypasses RLS, so the
-- API routes lose nothing; anon/authenticated fall back to deny (RLS is
-- already enabled on every one of these tables). The four intentional
-- "Public read" SELECT policies (brands, outlets, rewards, campaigns)
-- are kept — those tables stay anon-READABLE but stop being anon-writable.
--
-- Pre-apply verification (human):
--   1. Confirm the dashboard-stats route is live in production backoffice.
--   2. Supabase Dashboard → Logs → PostgREST: confirm no anon-role
--      requests to these tables in the last 7 days other than the pickup
--      page (which the route replaces).
--   3. Apply in the SQL editor or via Supabase MCP apply_migration.
--   4. Smoke test: order app checkout + OTP login + pickup dashboard
--      loyalty tab + POS loyalty lookup.
-- After applying: save this file under the loyalty project's migrations
-- dir per the db-migration skill, and update the access map + STATE.md.

DROP POLICY IF EXISTS "Service full access brands" ON brands;
DROP POLICY IF EXISTS "Service full access outlets" ON outlets;
DROP POLICY IF EXISTS "Service full access members" ON members;
DROP POLICY IF EXISTS "Service full access member_brands" ON member_brands;
DROP POLICY IF EXISTS "Service full access point_transactions" ON point_transactions;
DROP POLICY IF EXISTS "Service full access rewards" ON rewards;
DROP POLICY IF EXISTS "Service full access redemptions" ON redemptions;
DROP POLICY IF EXISTS "Service full access campaigns" ON campaigns;
DROP POLICY IF EXISTS "Service full access staff_users" ON staff_users;
DROP POLICY IF EXISTS "Service full access otp_codes" ON otp_codes;

-- ROLLBACK (restores the previous — insecure — behaviour):
-- CREATE POLICY "Service full access members" ON members FOR ALL USING (true) WITH CHECK (true);
-- ...and likewise for the other nine tables.
