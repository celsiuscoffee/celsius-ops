-- Delete-audit for hr_schedule_shifts.
--
-- A manager's Shah Alam roster "vanished" and static analysis could not pin the
-- exact deleter (deleted rows leave no trace on survivors). This records EVERY
-- shift deletion with the DB role + client application_name + the full old row,
-- so the next occurrence is traceable instead of a mystery. Append-only.
--
-- SECURITY DEFINER so the audit INSERT always succeeds regardless of which role
-- issued the delete (never blocks a legitimate delete). Applied via Supabase MCP
-- 2026-07-03.

CREATE TABLE IF NOT EXISTS hr_schedule_shift_audit (
  id           bigserial PRIMARY KEY,
  deleted_at   timestamptz NOT NULL DEFAULT now(),
  shift_id     uuid,
  schedule_id  uuid,
  user_id      text,
  shift_date   date,
  start_time   time,
  end_time     time,
  role_type    text,
  db_role      text,
  app_name     text,
  old_row      jsonb
);

ALTER TABLE hr_schedule_shift_audit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION audit_hr_schedule_shift_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO hr_schedule_shift_audit
    (shift_id, schedule_id, user_id, shift_date, start_time, end_time, role_type, db_role, app_name, old_row)
  VALUES
    (OLD.id, OLD.schedule_id, OLD.user_id, OLD.shift_date, OLD.start_time, OLD.end_time, OLD.role_type,
     current_user, current_setting('application_name', true), to_jsonb(OLD));
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_hr_schedule_shift_delete_audit ON hr_schedule_shifts;
CREATE TRIGGER trg_hr_schedule_shift_delete_audit
AFTER DELETE ON hr_schedule_shifts
FOR EACH ROW EXECUTE FUNCTION audit_hr_schedule_shift_delete();
