-- Explicit STATION on an employee's HR profile. Optional override for the
-- position→station inference the checklist auto-assign uses (STATION_POSITIONS
-- in ops-nudges): set it when someone works an area their job title doesn't
-- imply (e.g. a Cashier assigned to BOH, or a Director covering FOH).
-- NULL = infer from position, unchanged behaviour. FOH = front of house (bar),
-- BOH = back of house (kitchen). Pairs with Sop.stations (migration
-- 20260706_sop_station): a SOP has area(s), a person has an area.
ALTER TABLE hr_employee_profiles
  ADD COLUMN IF NOT EXISTS station text
  CHECK (station IS NULL OR station IN ('foh', 'boh', 'lead', 'shared'));
