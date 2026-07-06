-- Follow-up to 078: drop the now-unused single `station` column. Apply ONLY
-- after the code that reads `hr_employee_profiles.stations` (the multi-select)
-- is deployed to production, so no running code references the old column.
ALTER TABLE hr_employee_profiles DROP COLUMN IF EXISTS station;
