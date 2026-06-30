-- Performance Allowance v2 — single RM200 pool, 3 earn levers + deductions.
--
-- Replaces the old two-allowance model (attendance RM100 base + performance
-- RM100 composite score) with ONE performance pool (default RM200) split into
-- three lever slices, each scored 0-100 and paid by tier:
--   under-perform (<ok%) -> RM0 | ok (>=ok%) -> half slice | perform (>=perform%) -> full slice
--
-- Levers (defaults): Checklist RM80 / Phone RM40 / Serving RM40 / Audit RM40.
-- Each lever scores on its OWN KPI (not a uniform %):
--   Checklist = completion %  (>=90% full, >=70% half)
--   Phone     = capture rate vs outlet target (>=70% full, >=50% half) — FOH only
--   Serving   = AVERAGE serve time (<=15min full, <=20min half) — shift-wide
--   Audit     = outlet audit overallScore (>=70% full, >=50% half) — shift-wide
--               (follows phone capture's tier)
-- Phone is POSITION-gated (kitchen does no phone collection); a lever that
-- doesn't apply to a person redistributes its RM across the rest.
-- Deductions off the earned total (floor RM0, no caps): lateness + absence +
-- manager-approved negative reviews (RM10 each, <=2 star).
--
-- Old columns (attendance_allowance_amount, performance_tier_*, perf_weight_*,
-- attendance_late_tier_*) are LEFT IN PLACE (unused by the new engine) so the
-- existing settings UI doesn't break before it's updated; safe to drop later.

ALTER TABLE hr_company_settings
  ADD COLUMN IF NOT EXISTS perf_lever_checklist numeric NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS perf_lever_phone numeric NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS perf_lever_serving numeric NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS perf_lever_audit numeric NOT NULL DEFAULT 40,
  -- Checklist KPI: completion % thresholds.
  ADD COLUMN IF NOT EXISTS checklist_full_pct numeric NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS checklist_half_pct numeric NOT NULL DEFAULT 70,
  -- Phone AND audit tier thresholds (achievement / score %); audit follows phone.
  ADD COLUMN IF NOT EXISTS perf_tier_ok_pct numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS perf_tier_perform_pct numeric NOT NULL DEFAULT 70,
  -- Serving KPI: AVERAGE serve-time thresholds, in minutes.
  ADD COLUMN IF NOT EXISTS serving_full_minutes numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS serving_half_minutes numeric NOT NULL DEFAULT 20,
  -- Phone capture: full credit at the outlet's own baseline + uplift (so each
  -- outlet pushes up from where it is). Default baseline used when an outlet
  -- has too little history to measure.
  ADD COLUMN IF NOT EXISTS phone_capture_target_uplift_pp numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS phone_capture_default_baseline_pct numeric NOT NULL DEFAULT 40,
  -- Serving time: an order counts as on-time if served_at - created_at <= this.
  ADD COLUMN IF NOT EXISTS serving_target_minutes numeric NOT NULL DEFAULT 10,
  -- Lateness: <= grace = free; grace..absent_minutes = flat penalty; beyond = absent.
  ADD COLUMN IF NOT EXISTS attendance_lateness_grace_minutes numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS attendance_lateness_penalty numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS attendance_lateness_absent_minutes numeric NOT NULL DEFAULT 60;

-- Repoint the existing config row to the RM200 model.
UPDATE hr_company_settings SET
  performance_allowance_amount = 200,   -- the pool (sum of the three lever slices)
  review_penalty_amount = 10,           -- RM per approved negative review
  review_penalty_max_star_rating = 3,   -- <=3 star counts as negative
  attendance_penalty_absent = 20;       -- no-show / >60min-late
