-- 084: split public holidays into declared vs calendar-only.
--
-- The business observes only SOME gazetted public holidays. Declared ones
-- ("we announce and take them") drive OT pay and attendance rules; the rest
-- still move sales (customers get the day off) and must stay visible to the
-- revenue forecast, but must NOT trigger public-holiday pay.
--
--   declared = true  → OT pay + attendance rules apply (existing behaviour)
--   declared = false → sales-forecast/analysis only
--
-- Existing rows were all company-declared, so the default preserves payroll
-- behaviour exactly. Readers: payroll paths filter declared = true
-- (attendance-processor, staff clock, attendance-auto-close, manual
-- attendance edit); forecast paths read all rows (labour-gate,
-- ads autopilot, schedule grid).

alter table public.hr_public_holidays
  add column if not exists declared boolean not null default true;

comment on column public.hr_public_holidays.declared is
  'true = company announces/observes this holiday (drives OT pay + attendance rules); false = calendar holiday kept for sales forecasting only.';

-- Calendar-only national holidays missing from the May-Jun 2026 window,
-- verified against the sales data (both show clear demand effects).
insert into public.hr_public_holidays (date, name, year, is_national, declared)
values
  ('2026-05-31', 'Hari Wesak', 2026, true, false),
  ('2026-06-17', 'Awal Muharram', 2026, true, false)
on conflict (date, name) do nothing;
