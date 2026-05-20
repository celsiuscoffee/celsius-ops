-- Permit anon + authenticated roles to SELECT StockCount + StockCountItem so
-- Supabase realtime delivers postgres_changes events to subscribed staff
-- clients. Writes still go through the Prisma backend (DATABASE_URL → bypasses
-- RLS). No PII or sensitive data in these tables — just counted quantities
-- and product references — so a broad read policy is acceptable.
--
-- Applied to production on 2026-05-20 via Supabase MCP apply_migration with
-- name "stock_count_realtime_rls".

CREATE POLICY "Allow read access for realtime collab"
  ON "StockCountItem"
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow read access for realtime collab"
  ON "StockCount"
  FOR SELECT
  TO anon, authenticated
  USING (true);
