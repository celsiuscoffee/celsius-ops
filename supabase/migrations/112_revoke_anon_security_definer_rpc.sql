-- Mirror of packages/db/prisma/migrations/20260925_revoke_anon_security_definer_rpc.
-- See that file for the rationale. Apply once, by hand, with owner approval.

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
