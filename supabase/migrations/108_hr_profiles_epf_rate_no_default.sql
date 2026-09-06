-- 2026-09-03 — hr_employee_profiles EPF rate columns: no default, null = statutory schedule.
--
-- Both columns carried a DEFAULT (employee 11, employer 12), so every profile
-- ever created read 11.00 / 12.00, and the payroll calculator treated any
-- non-null value as a per-employee OVERRIDE. Net effect: employer EPF was
-- paid at 12% on every wage, where KWSP's Third Schedule says 13% up to
-- RM5,000 (12% only above). RM22/month short per RM2,200 staffer; the July
-- 2026 run was confirmed and filed that way (KWSP arrears owed for July).
--
-- The calculator now ignores an employer rate that merely equals the legacy
-- default on a ≤ RM5,000 wage (statutory/formulas.ts resolveEpfEmployerOverride),
-- so August computes correctly before this lands. This migration makes the
-- data honest: NULL means "use the schedule", and only a human-entered value
-- survives as an override.
--
-- Apply by hand (hard rule 6). Idempotent.

alter table public.hr_employee_profiles
  alter column epf_employee_rate drop default,
  alter column epf_employer_rate drop default;

-- Rows that only ever held the column default are not overrides.
update public.hr_employee_profiles
   set epf_employer_rate = null
 where epf_employer_rate = 12;

update public.hr_employee_profiles
   set epf_employee_rate = null
 where epf_employee_rate = 11;

comment on column public.hr_employee_profiles.epf_employer_rate is
  'Per-employee EMPLOYER EPF % override. NULL = KWSP Third Schedule (13% ≤ RM5,000 / 12% above for category A). Set only for a documented exception.';
comment on column public.hr_employee_profiles.epf_employee_rate is
  'Per-employee EMPLOYEE EPF % override (e.g. voluntary higher rate). NULL = KWSP schedule (11% category A).';
