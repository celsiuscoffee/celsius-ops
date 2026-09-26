-- Revoke anon / authenticated EXECUTE on SECURITY DEFINER functions that must
-- only ever be called from server code holding the service role.
--
-- Background (security review 2026-09-25): the Supabase advisor
-- `anon_security_definer_function_executable` listed 11 functions. Every one
-- runs as the definer and bypasses RLS, and the anon key ships inside every
-- customer / till app bundle. add_loyalty_points(member, brand, points, outlet)
-- alone lets anyone mint points to any member with one PostgREST call;
-- fin_fold_bank_journal / fin_gc_bank_journals mutate GL journals.
--
-- create_pos_sale is deliberately NOT in this list: apps/pos-native calls it
-- with the anon client (lib/sale-sync.ts). It stays open until sale sync moves
-- behind the bearer-authenticated POS API — tracked separately.
--
-- Written as a DO block over pg_proc so the exact argument signatures don't
-- have to be repeated here; a function that doesn't exist is skipped, so this
-- is safe to re-run.

DO $$
DECLARE
  fn text;
  sig text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'add_loyalty_points',
    'audit_hr_schedule_shift_delete',
    'fin_fold_bank_journal',
    'fin_gc_bank_journals',
    'fin_journal_line_guard',
    'fin_journal_lines_balance_check',
    'fin_txn_guard',
    'reconcile_pos_loyalty',
    'refresh_pos_pairing_signals',
    'tune_pair_weights'
  ] LOOP
    FOR sig IN
      SELECT p.oid::regprocedure::text
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
      RAISE NOTICE 'revoked anon/authenticated execute on %', sig;
    END LOOP;
  END LOOP;
END $$;
