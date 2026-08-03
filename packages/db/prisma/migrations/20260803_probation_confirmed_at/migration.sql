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
-- THE BACKFILL LIST, CONFIRMED BY THE OWNER 2026-08-03.
-- Pre-April-2026 joiners are long since confirmed. Mohd Haziq and Nor Armin were
-- queried specifically and the owner ruled "haziq and armin confirmed", so they
-- move across. Everyone else who joined from April onward stays on probation.
--
--   CONFIRMED (13) — allowance continues to pay
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
--     Nor Armin Hafifie              2026-04-16  Barista       ← owner 2026-08-03
--     Mohd Haziq                     2026-04-27  Kitchen Lead  ← owner 2026-08-03
--
--   ON PROBATION (9) — allowance withheld until someone confirms them
--     Ammar Roslizar                 2026-04-17
--     Ahmad Razley                   2026-05-05   (was paid RM150 in July)
--     Amirul Yazid                   2026-05-14   owner-named
--     Firdaus                        2026-05-31   owner-named
--     Nurul Alianatasha              2026-06-01   owner-named
--     Guraf Lal Joshi                2026-06-17   owner-named
--     Nur Nazihah                    2026-06-19   owner-named
--     Nur Iffa Sofea                 2026-06-23   owner-named (was paid RM120)
--     Muhammad Akmal Aiman           2026-07-06   owner-named
--
-- July claw-back implied: Razley 150 + Iffa 120 = RM270. Haziq's 200 and Armin's
-- 70 now stand. July is `confirmed`, so realising the RM270 needs an unlock and
-- recompute — deliberately NOT done here.
--
-- WHICH DATE. For the pre-April group, `confirmed_at = join_date`. Their real
-- confirmation dates are recorded nowhere, and the join date is honest about
-- that — it says "confirmed at least since they started" and cannot accidentally
-- withhold a month, since any date at or before month end pays.
--
-- Haziq and Armin are dated to the END of their probation (join + 90 days:
-- 2026-07-26 and 2026-07-15) rather than their join date, because they DID serve
-- a probation — backdating to the join date would assert they never had one.
-- Both dates fall inside July, so July pays either way; the difference is that
-- June correctly stays withheld.
--
-- SQL-managed table (hr_* are not in schema.prisma). Apply manually via
-- Supabase SQL — hybrid workflow, docs/database-migrations.md.
-- NEVER prisma db push / migrate deploy.

BEGIN;

ALTER TABLE hr_employee_profiles
  ADD COLUMN IF NOT EXISTS confirmed_at date;

COMMENT ON COLUMN hr_employee_profiles.confirmed_at IS
  'The date this employee was confirmed (probation ended). NULL = still on probation, regardless of how long ago they joined — probation is ended by an act of confirmation, never by elapsed time. Written by the probation-review flow when an approved decision=confirm review lands. The performance allowance is withheld while this is NULL. Do NOT confuse with probation_end_date, which is only when the review is DUE.';

-- Backfill 1: everyone hired before April 2026 — long since confirmed.
UPDATE hr_employee_profiles
   SET confirmed_at = join_date,
       updated_at   = now()
 WHERE confirmed_at IS NULL
   AND join_date IS NOT NULL
   AND join_date < DATE '2026-04-01';

-- Backfill 2: Mohd Haziq and Nor Armin, confirmed by the owner 2026-08-03.
-- Dated to the end of the probation they actually served, not their join date.
-- Matched on user_id so a name change cannot silently miss them.
UPDATE hr_employee_profiles
   SET confirmed_at = join_date + 90,
       updated_at   = now()
 WHERE confirmed_at IS NULL
   AND user_id IN (
     '6ff33793-1374-459d-93f2-02cd9c0ff0f9',  -- Mohd Haziq   joined 2026-04-27 → 2026-07-26
     '69d05911-b402-4b98-b5dc-8d954094b98d'   -- Nor Armin    joined 2026-04-16 → 2026-07-15
   );

COMMIT;

-- Expected after apply, across ALL profiles (not just active full-timers):
--   select count(*) filter (where confirmed_at is not null) as confirmed,
--          count(*) filter (where confirmed_at is null)     as on_probation
--     from hr_employee_profiles where end_date is null and resigned_at is null;
--
-- Then recompute any month you want the gate to apply to. It is not retroactive
-- on its own: July is already `confirmed` and keeps the figures it has.
