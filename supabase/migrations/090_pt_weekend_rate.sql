-- 090: PT weekend rate (owner rule 2026-07-18, from the "Celsius - Part Timer
-- 2025/26" wage sheet): part-timers earn a HIGHER hourly rate on Sat/Sun.
-- hourly_rate stays the WEEKDAY base; hourly_rate_weekend is the Sat/Sun rate
-- (NULL = fall back to hourly_rate, so the column is backwards-compatible).
-- Public holidays pay 2x the day's base — handled in code, no column needed.
-- Additive only.

ALTER TABLE hr_employee_profiles
  ADD COLUMN IF NOT EXISTS hourly_rate_weekend numeric;

COMMENT ON COLUMN hr_employee_profiles.hourly_rate_weekend IS
  'PT hourly rate on Sat/Sun (RM). NULL falls back to hourly_rate. Weekday base lives in hourly_rate. Public-holiday 2x is applied in code.';
