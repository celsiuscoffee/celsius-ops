-- APPLIED to production 2026-06-12 (Supabase migration
-- prior_customer_phones_fn_and_dup_index_cleanup).

SET LOCAL lock_timeout = '5s';

-- Duplicate index cleanup (identical definitions verified via
-- pg_indexes 2026-06-12; the survivors stay declared in the repo):
DROP INDEX IF EXISTS idx_order_items_order_id;   -- dup of idx_order_items_order
DROP INDEX IF EXISTS "idx_Invoice_outletId";     -- dup of "Invoice_outletId_idx"

-- Distinct prior customer phones for the sales dashboards' new-vs-repeat
-- split. Replaces two 50k-row raw fetches per dashboard load (the JS
-- only ever built Sets from them). Returns one row per unique phone
-- seen before p_before across the scoped outlets; app_customer=true if
-- any of those orders came through the pickup app (the dashboards keep
-- a separate app-only prior set).
--
-- SECURITY INVOKER (default): callers see exactly the rows their role
-- could already read with direct selects — no privilege change.
CREATE OR REPLACE FUNCTION prior_customer_phones(
  p_before timestamptz,
  p_pos_codes text[] DEFAULT '{}',
  p_store_ids text[] DEFAULT '{}'
) RETURNS TABLE(phone text, app_customer boolean)
LANGUAGE sql STABLE AS $$
  SELECT t.phone, bool_or(t.is_app) AS app_customer FROM (
    SELECT customer_phone AS phone, false AS is_app
      FROM pos_orders
      WHERE outlet_id = ANY(p_pos_codes)
        AND created_at < p_before
        AND customer_phone IS NOT NULL
    UNION ALL
    SELECT customer_phone, true
      FROM orders
      WHERE store_id = ANY(p_store_ids)
        AND created_at < p_before
        AND customer_phone IS NOT NULL
  ) t GROUP BY t.phone
$$;
