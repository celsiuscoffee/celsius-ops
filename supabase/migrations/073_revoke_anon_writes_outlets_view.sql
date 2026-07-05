-- Applied 2026-07-05 via Supabase MCP (apply_migration:
-- revoke_anon_writes_outlets_view). Saved here for the audit trail per
-- docs/database-migrations.md — do not re-run.
--
-- Finding (2026-07-05 live-DB audit): public.outlets is a postgres-owned
-- VIEW over "Outlet" (outlet master config — names, addresses, Grab
-- merchant ids, company reg) WITHOUT security_invoker, so DML through it
-- runs with the owner's privileges and bypasses RLS on "Outlet". anon and
-- authenticated held INSERT/UPDATE/DELETE grants — a live write path into
-- outlet config using the published anon key via PostgREST.
--
-- SELECT is retained: the order app's public store list reads this view.
-- Verified after apply: anon/authenticated = REFERENCES,SELECT,TRIGGER only.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.outlets FROM anon, authenticated;
