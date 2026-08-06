-- Repair the Sunday-poisoned rest-day stamps on attendance logs and OT
-- requests, roster-authoritatively.
--
-- Owner 2026-08-03: "2x rest day still not follow schedule" / "rest-day is
-- only when we schedule. it is not fixed on weekends" / "the logic is that
-- they are entitled to one restday per week."
--
-- Two poisons being cleaned, one source:
--
--   1. The old profile.rest_day gate (`?? 0` = Sunday for everybody) stamped
--      Sunday logs `rest_day_1x` / `ot_2x`. Measured before this repair:
--      123 logs stamped rest-day since 1 July, and NOT ONE falls on a
--      rostered rest day (42 ot_2x carrying 43 OT hours + 81 rest_day_1x).
--   2. The OT sync copied those stamps into hr_overtime_requests.ot_type:
--      22 rows typed '2x' since 1 July, none on a rostered rest day —
--      including TWO APPROVED (Shairuleen 2h + Tengku 2h, Sunday 5 Jul),
--      which a recompute would have paid at 2× against a weekday roster.
--
-- Also seen on Sunday 2 Aug: the whole crew flagged `rest_day_work` from a
-- roster that was re-published later the same day. The calculator now
-- re-derives the RATE from the final roster at compute time (ot-policy.ts,
-- effectiveOtType), so pay is safe either way — this repair fixes the stored
-- labels so the review queue, the OT queue and any other reader stop lying.
--
-- Direction is one-way: rest-day stamps with no rostered rest row become
-- weekday classes. The reverse (weekday stamps ON a rostered rest day) is
-- left to the calculator's compute-time correction — SQL cannot re-derive
-- flags reliably, and the pay outcome is already right.
--
-- SQL-managed tables (hr_* are not in schema.prisma). Apply manually via
-- Supabase SQL — hybrid workflow, docs/database-migrations.md.
-- NEVER prisma db push / migrate deploy.

BEGIN;

-- Logs stamped ot_2x with no rostered rest day → weekday OT (1.5×), and drop
-- the rest_day_work badge from the review queue.
UPDATE hr_attendance_logs a
   SET overtime_type = 'ot_1_5x',
       ai_flags = array_remove(a.ai_flags, 'rest_day_work')
 WHERE a.overtime_type = 'ot_2x'
   AND (a.clock_in AT TIME ZONE 'Asia/Kuala_Lumpur')::date >= DATE '2026-07-01'
   AND NOT EXISTS (
     SELECT 1 FROM hr_schedule_shifts s
      WHERE s.user_id = a.user_id
        AND s.shift_date = (a.clock_in AT TIME ZONE 'Asia/Kuala_Lumpur')::date
        AND s.role_type ILIKE 'rest%'
   );

-- Logs stamped rest_day_1x with no rostered rest day: the label is the whole
-- payload (their OT hours are 0.00 across the board), so it clears to NULL.
UPDATE hr_attendance_logs a
   SET overtime_type = NULL,
       ai_flags = array_remove(a.ai_flags, 'rest_day_work')
 WHERE a.overtime_type = 'rest_day_1x'
   AND (a.clock_in AT TIME ZONE 'Asia/Kuala_Lumpur')::date >= DATE '2026-07-01'
   AND NOT EXISTS (
     SELECT 1 FROM hr_schedule_shifts s
      WHERE s.user_id = a.user_id
        AND s.shift_date = (a.clock_in AT TIME ZONE 'Asia/Kuala_Lumpur')::date
        AND s.role_type ILIKE 'rest%'
   );

-- The rest_day_work badge with a weekday/no stamp — same poison, badge only.
UPDATE hr_attendance_logs a
   SET ai_flags = array_remove(a.ai_flags, 'rest_day_work')
 WHERE 'rest_day_work' = ANY(a.ai_flags)
   AND (a.clock_in AT TIME ZONE 'Asia/Kuala_Lumpur')::date >= DATE '2026-07-01'
   AND NOT EXISTS (
     SELECT 1 FROM hr_schedule_shifts s
      WHERE s.user_id = a.user_id
        AND s.shift_date = (a.clock_in AT TIME ZONE 'Asia/Kuala_Lumpur')::date
        AND s.role_type ILIKE 'rest%'
   );

-- OT requests typed 2× on days that are not rostered rest days → 1.5×.
-- Covers the two APPROVED Sunday rows that would otherwise pay 2× on
-- recompute, and the cancelled/rejected clutter for consistency.
UPDATE hr_overtime_requests r
   SET ot_type = '1.5x'
 WHERE r.ot_type = '2x'
   AND r.date >= DATE '2026-07-01'
   AND NOT EXISTS (
     SELECT 1 FROM hr_schedule_shifts s
      WHERE s.user_id = r.user_id
        AND s.shift_date = r.date
        AND s.role_type ILIKE 'rest%'
   );

COMMIT;

-- Verify after apply — all four counts should be 0:
--   select count(*) from hr_attendance_logs a
--    where a.overtime_type in ('ot_2x','rest_day_1x')
--      and (a.clock_in at time zone 'Asia/Kuala_Lumpur')::date >= '2026-07-01'
--      and not exists (select 1 from hr_schedule_shifts s
--                       where s.user_id=a.user_id
--                         and s.shift_date=(a.clock_in at time zone 'Asia/Kuala_Lumpur')::date
--                         and s.role_type ilike 'rest%');
--   (same shape for ai_flags and for hr_overtime_requests.ot_type='2x')
