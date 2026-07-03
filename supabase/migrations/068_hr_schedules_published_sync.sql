-- Kill the dual source of truth for "published" on hr_schedules.
--
-- The UI + staff app gate on status='published'; the ops loops (checklist
-- owner, on-shift team, lateness nudge) gate on published_at IS NOT NULL.
-- The BrioHR import (April 2026) wrote status='published' with published_at
-- NULL, so those weeks looked published everywhere except the ops loops —
-- the "published but suddenly incomplete" ghost. This trigger makes the two
-- fields inseparable no matter which writer misbehaves next.
--
-- Captured for reproducibility per docs/database-migrations.md (never
-- auto-run; applied via Supabase MCP 2026-07-03).

-- One-time repair: the 7 divergent import rows (status published, no
-- timestamp). Past weeks, so operationally inert, but divergence breeds bugs.
UPDATE hr_schedules
SET published_at = created_at
WHERE status = 'published' AND published_at IS NULL;

-- Keep them in lockstep forever:
--   status -> 'published'  and no timestamp => stamp now()
--   status -> anything else                 => clear the timestamp
CREATE OR REPLACE FUNCTION sync_hr_schedule_published()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  ELSIF NEW.status IS DISTINCT FROM 'published' THEN
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hr_schedules_published_sync ON hr_schedules;
CREATE TRIGGER trg_hr_schedules_published_sync
BEFORE INSERT OR UPDATE ON hr_schedules
FOR EACH ROW EXECUTE FUNCTION sync_hr_schedule_published();
