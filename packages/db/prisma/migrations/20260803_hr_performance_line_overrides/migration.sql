-- Every line of the performance allowance is editable by hand — levers as well
-- as deductions — and the whole-month override is gone.
--
-- Owner 2026-08-03: "we need to make the lever edit manual. remove the replace
-- the whole month."
--
-- Two hours earlier this table shipped as hr_performance_deduction_waivers,
-- which could only ever REDUCE a deduction. That was the right bound for
-- waiving a wrongly-docked absence and the wrong shape for the actual need:
-- the engine is also wrong about levers — a checklist that was never assigned,
-- a serving-time average dragged down by one broken shift — and the only
-- remedy was to replace the whole month with a flat figure, which threw away
-- the scoring it was meant to correct.
--
-- So the table generalises: one row = one LINE of the breakdown, whatever kind.
--
--   line_key                        what `amount` means           clamped to
--   ------------------------------  ----------------------------  ------------
--   lever|checklist                 RM to pay for that lever      [0, pool]
--   lever|phone
--   lever|serving
--   lever|audit
--   late|<attendance_log_id>        RM to charge for that line    [0, computed]
--   absent|<attendance_log_id>
--   noshow|<YYYY-MM-DD>
--   review|<hr_review_penalty_id>
--
-- Keyed on the source row, never a position in a list, so re-running the engine
-- cannot slide an edit onto a different day's deduction.
--
-- The clamps are what keep this delegable to a MANAGER. A deduction edit can
-- only give back money the engine took. A lever edit cannot exceed the pool, so
-- no per-person month can be inflated past the allowance itself.
--
-- Renaming rather than creating: the table shipped empty and is still empty
-- (verified 0 rows before this ran), so there is no data to migrate and no
-- window where two tables disagree.
--
-- ALSO: hr_performance_overrides — the whole-month replace — is no longer read
-- by anything. It is left in place rather than dropped so the decision is
-- reversible; it is empty too. Drop it in a later housekeeping pass once the
-- new shape has been used for a full cycle.
--
-- SQL-managed table (not in schema.prisma). Apply manually via Supabase SQL —
-- hybrid workflow, docs/database-migrations.md. NEVER prisma db push / migrate deploy.

ALTER TABLE hr_performance_deduction_waivers RENAME TO hr_performance_line_overrides;
ALTER TABLE hr_performance_line_overrides RENAME COLUMN deduction_key TO line_key;
ALTER TABLE hr_performance_line_overrides RENAME COLUMN waived_amount TO amount;

ALTER INDEX IF EXISTS hr_performance_deduction_waivers_period_idx
  RENAME TO hr_performance_line_overrides_period_idx;

COMMENT ON TABLE hr_performance_line_overrides IS
  'Manual per-line edit of a computed performance allowance. One row = one line: a lever (amount = RM to pay, clamped to the pool) or a deduction (amount = RM to charge, clamped to what the engine computed). Keyed on the source row so it survives a recompute. Does not carry into the next month.';

COMMENT ON COLUMN hr_performance_line_overrides.line_key IS
  'lever|<checklist|phone|serving|audit>, late|<log id>, absent|<log id>, noshow|<YYYY-MM-DD>, or review|<hr_review_penalty id>.';

COMMENT ON COLUMN hr_performance_line_overrides.amount IS
  'What to pay (lever) or charge (deduction) for this line INSTEAD of the computed figure. Not a delta.';
