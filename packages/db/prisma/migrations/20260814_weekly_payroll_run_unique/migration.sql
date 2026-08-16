-- One weekly payroll run per week — the calculator's settled-check → delete →
-- insert sequence is not atomic, so two concurrent Computes could each insert a
-- run for the same period and the bank file could pick either. The only unique
-- index on hr_payroll_runs covered (period_month, period_year), i.e. monthly.
--
-- Partial on cycle_type='weekly': monthly runs key on period_month/period_year
-- and may reuse period_start semantics differently.
--
-- SQL-managed table (not in Prisma schema) — apply via the db-migration
-- workflow, never prisma migrate deploy.
CREATE UNIQUE INDEX IF NOT EXISTS hr_payroll_runs_weekly_period_key
  ON hr_payroll_runs (period_start)
  WHERE cycle_type = 'weekly';
