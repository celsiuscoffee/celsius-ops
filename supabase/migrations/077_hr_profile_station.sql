-- Explicit STATION on an employee's HR profile. Optional override for the
-- position→station inference the checklist auto-assign uses (STATION_POSITIONS
-- in ops-nudges): set it when someone works a station their job title doesn't
-- imply (e.g. a Cashier who runs the bar, or a Director who covers kitchen).
-- NULL = infer from position, unchanged behaviour. Pairs with Sop.station
-- (migration 20260706_sop_station): SOP has a station, person has a station.
ALTER TABLE hr_employee_profiles
  ADD COLUMN IF NOT EXISTS station text
  CHECK (station IS NULL OR station IN ('barista', 'kitchen', 'lead', 'cleaning', 'shared'));
