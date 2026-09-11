-- Hold monthly payslips back until a fixed day of the following month.
--
-- Owner 2026-09-11: "can we open payslip after 15th?" Until now a payslip
-- appeared to staff the instant its run reached `confirmed` — the July run was
-- confirmed on 7 Aug, so staff saw it on the 7th, potentially before the money
-- landed. This adds the release day HR asked for.
--
-- NULL (the default) keeps today's behaviour exactly: released on confirmation.
-- A value 1..28 means "monthly payslips for period M become visible on that day
-- of month M+1" (so August payroll opens 15 September when set to 15). Capped at
-- 28 so the date exists in February; the reader clamps to the month's last day
-- anyway.
--
-- WEEKLY (part-timer) runs are deliberately NOT gated by this — a PT is paid
-- weekly, and holding their slip to a monthly date would hide it for up to three
-- weeks. See apps/staff/src/lib/hr/payslip-release.ts.
--
-- NOTE: hr_* tables are SQL-managed and absent from schema.prisma, so there is
-- no Prisma-side change to match. Apply manually via the Supabase SQL editor —
-- hybrid workflow, docs/database-migrations.md.
-- NEVER prisma db push / prisma migrate deploy.

ALTER TABLE hr_company_settings
  ADD COLUMN IF NOT EXISTS payslip_release_day SMALLINT;

ALTER TABLE hr_company_settings
  DROP CONSTRAINT IF EXISTS hr_company_settings_payslip_release_day_range;

ALTER TABLE hr_company_settings
  ADD CONSTRAINT hr_company_settings_payslip_release_day_range
  CHECK (payslip_release_day IS NULL OR (payslip_release_day BETWEEN 1 AND 28));

COMMENT ON COLUMN hr_company_settings.payslip_release_day IS
  'Day of the FOLLOWING month on which a monthly payslip becomes visible to staff (1-28). NULL = visible as soon as the run is confirmed. Weekly PT runs are never gated by this.';
