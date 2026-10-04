-- Applied to production 2026-10-04 (owner-approved: "apply it").
--
-- Incident: Putrajaya (outlet-con) till could not upload sales from 11:00 MYT
-- on 2026-10-03. A GrabFood order numbered "GF-942" (digit-only tail) became
-- the till's reference for its next number, so the till sent CC-CON-0943,
-- which already existed. create_pos_sale then renumbered to MAX+1 = 10451, but
-- lpad(v_seq::text, 4, '0') TRUNCATES to '1045'. CC-CON-1045 exists (June), so
-- the WHILE loop re-tested the same truncated number until statement_timeout
-- (8s). 380 sale uploads timed out; the till dead-lettered them.
--
-- Fix: pad to at least 4 digits and never truncate. Only the two lpad calls
-- change; the rest of the function body is preserved exactly as deployed.
-- Verified: the failing payload now returns CC-CON-10451 in ~0.1s.

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.create_pos_sale(jsonb)'::regprocedure) INTO def;
  IF position('lpad(v_seq::text, 4, ''0'')' in def) = 0 THEN
    -- Already patched (or the body changed): nothing to do.
    IF position('greatest(4, length(v_seq::text))' in def) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'create_pos_sale body changed; review before patching';
  END IF;
  def := replace(def, 'lpad(v_seq::text, 4, ''0'')',
                      'lpad(v_seq::text, greatest(4, length(v_seq::text)), ''0'')');
  EXECUTE def;
END $$;
