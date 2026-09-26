-- 2026-09-25 QA sweep, Critical: create_pos_sale is SECURITY DEFINER and was
-- executable by anon/authenticated, and the anon key ships in every POS APK
-- (apps/pos-native/eas.json). Anyone holding it could POST
-- /rest/v1/rpc/create_pos_sale and fabricate completed sales — any outlet,
-- any cashier's employee_id, any discount — straight into pos_orders,
-- corrupting Z-reports and the finance revenue lens.
--
-- The till now lands sales through POST /api/pos/sales (backoffice), which
-- requires the POS staff session and runs the RPC with the service role. Once
-- every till runs that build, nothing legitimate calls the RPC as anon.
--
-- ORDER OF OPERATIONS — apply this ONLY after the pos-native OTA carrying the
-- /api/pos/sales sync has reached every SUNMI till (check the tills' version
-- in backoffice, or that [pos-sales] requests are arriving from every outlet).
-- A till still on the old build gets a permission error from the RPC, counts
-- it as a per-sale rejection, and after 5 attempts DEAD-LETTERS the sale
-- (kept on the device, but needs manual recovery). Not applied yet — see
-- KNOWN_UNAPPLIED.json. Idempotent: re-running is a no-op.

DO $$
DECLARE
  sig text;
BEGIN
  FOR sig IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_pos_sale'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
    RAISE NOTICE 'revoked anon/authenticated execute on %', sig;
  END LOOP;
END $$;
