-- Opt-out audit trail (applied live 2026-08-02). Before this, sms_opt_out was a
-- bare boolean with no record of WHEN it flipped — so "did we message someone
-- after they opted out?" could only be inferred from members.updated_at, which
-- isn't reliably bumped (manual SQL, some API paths). PDPA questions need a
-- provable answer.
--
-- A TRIGGER rather than app-code so EVERY write path is covered: the members
-- API, the admin UI toggle, the POS lookup, and hand-run SQL alike.
ALTER TABLE members ADD COLUMN IF NOT EXISTS sms_opt_out_at timestamptz;

CREATE OR REPLACE FUNCTION members_stamp_sms_opt_out()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sms_opt_out IS DISTINCT FROM OLD.sms_opt_out THEN
    NEW.sms_opt_out_at := CASE WHEN NEW.sms_opt_out THEN now() ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_members_stamp_sms_opt_out ON members;
CREATE TRIGGER trg_members_stamp_sms_opt_out
  BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION members_stamp_sms_opt_out();

CREATE OR REPLACE FUNCTION members_stamp_sms_opt_out_ins()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sms_opt_out AND NEW.sms_opt_out_at IS NULL THEN NEW.sms_opt_out_at := now(); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_members_stamp_sms_opt_out_ins ON members;
CREATE TRIGGER trg_members_stamp_sms_opt_out_ins
  BEFORE INSERT ON members FOR EACH ROW EXECUTE FUNCTION members_stamp_sms_opt_out_ins();

-- Backfill existing opt-outs with their best-known timestamp (updated_at).
-- Estimate only: for older rows the flag may have been set later without
-- bumping updated_at — exactly the ambiguity this column removes going forward.
UPDATE members SET sms_opt_out_at = updated_at
WHERE sms_opt_out = true AND sms_opt_out_at IS NULL;
