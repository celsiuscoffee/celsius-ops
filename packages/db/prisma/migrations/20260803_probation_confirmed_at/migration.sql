-- Probation ends on CONFIRMATION, not on elapsed time.
--
-- Owner 2026-08-03: "probation will end only after confirmation. it is not time
-- base."
--
-- WHY A NEW COLUMN. Nothing in the database currently records that anybody has
-- been confirmed:
--
--   * `hr_probation_reviews` is EMPTY — zero rows, ever. The review flow exists
--     and works, it has simply never been used.
--   * `hr_employee_profiles.probation_end_date` is NULL on all 62 active
--     profiles. And it could not serve as the marker anyway: the only thing that
--     writes it is the EXTEND decision, which pushes it into the future while the
--     person is still on probation. It means "review due", not "confirmed".
--
-- So a confirmation-only gate reading today's data would put all 22 active
-- full-timers on probation and wipe roughly RM1,573 of allowance a month, Syafiq
-- Aiman (joined 2021) included. The rule is right; the data to apply it does not
-- exist yet. This migration creates it and backfills the people who are already
-- confirmed in fact.
--
-- ⚠ THE BACKFILL LIST BELOW IS A PROPOSAL AND NEEDS THE OWNER'S EYES.
-- It is drawn from the owner's own statements this session: the seven named as
-- probation staff, plus everyone who joined from April 2026 and has never been
-- reviewed. Everyone hired before that is treated as long-since confirmed.
-- Moving one name between the lists changes that person's pay.
--
--   CONFIRMED (11) — allowance continues to pay
--     Ammar Bin Shahrin              2021-01-01  Director
--     Muhamad Syafiq Aiman           2021-02-08  Barista Lead
--     Tengku Syahirah Balqis         2025-05-01  Barista
--     Nur Atthira                    2025-08-03  Barista
--     Azmer Zul Qiefli               2025-11-01  Kitchen Crew
--     Ariff Izham                    2025-11-01  Head of Department
--     Hanisa Amirah                  2025-12-25  Barista
--     Muhammad Ameir Haziq           2025-12-25  Kitchen Lead
--     Zikry Yusuf                    2026-01-16  Kitchen Crew
--     Shairuleen                     2026-02-01  Kitchen Lead
--     Nuralia Aina                   2026-02-16  Barista
--
--   ON PROBATION (11) — allowance withheld until someone confirms them
--     Nor Armin Hafifie              2026-04-16   (was paid RM70 in July)
--     Ammar Roslizar                 2026-04-17
--     Mohd Haziq                     2026-04-27   (was paid RM200 in July)
--     Ahmad Razley                   2026-05-05   (was paid RM150 in July)
--     Amirul Yazid                   2026-05-14   owner-named
--     Firdaus                        2026-05-31   owner-named
--     Nurul Alianatasha              2026-06-01   owner-named
--     Guraf Lal Joshi                2026-06-17   owner-named
--     Nur Nazihah                    2026-06-19   owner-named
--     Nur Iffa Sofea                 2026-06-23   owner-named (was paid RM120)
--     Muhammad Akmal Aiman           2026-07-06   owner-named
--
-- July claw-back implied: 70 + 200 + 150 + 120 = RM540. July is `confirmed`, so
-- realising it needs an unlock and recompute — deliberately NOT done here.
--
-- The confirmed_at date is set to the join date for the backfilled group. Their
-- real confirmation dates are not recorded anywhere; using the join date is
-- honest about that (it says "confirmed at least since they started") and it
-- cannot accidentally withhold a month, because any date at or before the month
-- end pays.
--
-- SQL-managed table (hr_* are not in schema.prisma). Apply manually via
-- Supabase SQL — hybrid workflow, docs/database-migrations.md.
-- NEVER prisma db push / migrate deploy.

BEGIN;

ALTER TABLE hr_employee_profiles
  ADD COLUMN IF NOT EXISTS confirmed_at date;

COMMENT ON COLUMN hr_employee_profiles.confirmed_at IS
  'The date this employee was confirmed (probation ended). NULL = still on probation, regardless of how long ago they joined — probation is ended by an act of confirmation, never by elapsed time. Written by the probation-review flow when an approved decision=confirm review lands. The performance allowance is withheld while this is NULL. Do NOT confuse with probation_end_date, which is only when the review is DUE.';

-- Backfill: everyone hired before April 2026, none of whom the owner has flagged
-- as still on probation. Confirmed as of their join date — see the note above on
-- why that date and not another.
UPDATE hr_employee_profiles
   SET confirmed_at = join_date,
       updated_at   = now()
 WHERE confirmed_at IS NULL
   AND join_date IS NOT NULL
   AND join_date < DATE '2026-04-01';

COMMIT;

-- Expected after apply, across ALL profiles (not just active full-timers):
--   select count(*) filter (where confirmed_at is not null) as confirmed,
--          count(*) filter (where confirmed_at is null)     as on_probation
--     from hr_employee_profiles where end_date is null and resigned_at is null;
--
-- Then recompute any month you want the gate to apply to. It is not retroactive
-- on its own: July is already `confirmed` and keeps the figures it has.
