-- A FIXED phone-capture target for every outlet, replacing baseline + uplift.
--
-- Owner 2026-08-03: "put phone target 70% for all."
--
-- The lever previously set each outlet its own target: the outlet's own capture
-- rate over the trailing 90 days, plus 15pp, capped at 95. Two problems with
-- that, one of them a bug.
--
-- The bug: the baseline was read with a plain PostgREST select and no .range(),
-- so it only ever saw the FIRST 1000 rows PostgREST returns — the oldest 1000
-- orders in the window. Every outlet is well past that (Putrajaya 5,601 /
-- Shah Alam 4,457 / Tamarind 4,192 orders in 90 days), so every target was
-- computed from roughly the stalest quarter of the data and came out too low:
--
--   outlet      true 90d capture   target set   target it should have been
--   Putrajaya   45.4%              (stale)      60%
--   Shah Alam   68.0%              (stale)      83%
--   Tamarind    29.4%              35%          44%
--
-- Tamarind's 35% is what prompted the question, and it is exactly what the
-- oldest 1000 Tamarind orders give (20.0% + 15).
--
-- The design problem, which is the reason for this change rather than just
-- fixing the query: a self-referential target rewards a low starting point. The
-- outlet with the worst capture gets the easiest bar, and improving your rate
-- immediately raises your own target. One flat number across the company is
-- both fairer and legible to staff.
--
-- NULL keeps the old baseline + uplift behaviour, so this is reversible by
-- clearing the column — the code path is still there.
--
-- SQL-managed table (not in schema.prisma). Apply manually via Supabase SQL —
-- hybrid workflow, docs/database-migrations.md. NEVER prisma db push / migrate deploy.

ALTER TABLE hr_company_settings
  ADD COLUMN IF NOT EXISTS phone_capture_target_pct numeric;

COMMENT ON COLUMN hr_company_settings.phone_capture_target_pct IS
  'Fixed phone-capture target (%) applied to every outlet. When set, the per-outlet trailing-90-day baseline + uplift is not computed at all. NULL restores the old per-outlet behaviour.';

UPDATE hr_company_settings SET phone_capture_target_pct = 70;
