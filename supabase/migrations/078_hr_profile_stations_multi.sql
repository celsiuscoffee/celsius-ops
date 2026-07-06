-- Employee station goes MULTI-VALUED so a floating shift lead / supervisor can
-- be tagged FOH+BOH and be eligible for both areas' checklists. Additive: adds
-- `stations text[]` and backfills from the single `station`. The old `station`
-- column is kept for the deploy window (the live code still reads it) and
-- dropped in the follow-up migration 079 once the code reading `stations` is out.
ALTER TABLE hr_employee_profiles
  ADD COLUMN IF NOT EXISTS stations text[] NOT NULL DEFAULT '{}';

-- Carry over the single value everyone already has.
UPDATE hr_employee_profiles
  SET stations = ARRAY[station]
  WHERE station IS NOT NULL AND stations = '{}';

-- Only the four house areas are valid; empty array = infer from position.
ALTER TABLE hr_employee_profiles
  ADD CONSTRAINT hr_employee_profiles_stations_valid
  CHECK (stations <@ ARRAY['foh','boh','lead','shared']::text[]);
