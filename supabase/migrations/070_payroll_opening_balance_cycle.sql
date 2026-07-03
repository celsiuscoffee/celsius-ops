-- Allow an "opening_balance" payroll run — used to carry a mid-year YTD forward
-- from a prior payroll system (BrioHR, whose last run was June 2026) so the
-- in-house monthly PCB stays cumulative and the EA form reconciles.
--
-- Same shape as a weekly run (period_start/end, no period_month). Already applied
-- to prod on 2026-07-03 alongside the BrioHR YTD import (run 38752e06); this file
-- keeps the repo in sync. See payroll-calculator.ts: the YTD query now unions
-- prior monthly runs with the opening_balance run.
alter table hr_payroll_runs drop constraint if exists hr_payroll_runs_cycle_fields;
alter table hr_payroll_runs add constraint hr_payroll_runs_cycle_fields check (
  (cycle_type = 'monthly' and period_month is not null and period_year is not null)
  or (cycle_type = 'weekly' and period_start is not null and period_end is not null)
  or (cycle_type = 'opening_balance' and period_start is not null and period_end is not null)
);
