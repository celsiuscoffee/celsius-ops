-- Correct the migration-102 backfill where it is provably wrong.
-- (Applied live 2026-08-02.)
--
-- 102 seeded sms_opt_out_at from members.updated_at as a best-effort estimate.
-- For at least one member that estimate is contradicted by the record: their
-- backfilled opt-out (2026-05-17, = row creation) predates 7 sends in June,
-- yet the segment filter (reachable() skips sms_opt_out) makes assigning an
-- opted-out member impossible -- and the loops stopped assigning them entirely
-- from Jun 27. The flag was therefore set AFTER those sends, with updated_at
-- never bumped; the backfill invented a violation that did not happen.
--
-- Rather than assert a date we cannot prove, set such rows to NULL = "opted out
-- at an unknown time, predating the audit trail". Compliance checks read
-- "sends after sms_opt_out_at" and skip NULLs, so unknowns can't manufacture
-- either a false violation or false innocence. Every opt-out from 2026-08-02
-- onward is trigger-stamped and exact.
UPDATE members m
SET sms_opt_out_at = NULL
WHERE m.sms_opt_out = true
  AND m.sms_opt_out_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM loop_assignments la
    JOIN loop_rounds lr ON lr.id = la.round_id
    WHERE la.phone = m.phone AND la.sms_status = 'sent' AND lr.sent_at > m.sms_opt_out_at
  );
