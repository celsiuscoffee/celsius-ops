-- PCB: the RM400 individual rebate (Income Tax Act 1967 s.6A(2)) was missing.
--
-- A resident individual whose CHARGEABLE income does not exceed RM35,000 gets a
-- RM400 rebate off the tax charged. It is a REBATE, not a relief — it comes off
-- the tax, not the income — and it is what zeroes PCB for the low end of a
-- payroll. calcPCB never applied it and hr_stat_pcb_reliefs had no row for it.
--
-- This is the single reason our PCB disagreed with BrioHR for everyone except
-- Ariff. On the Jul 2026 run we charged 15 people where BrioHR charged 1. Every
-- one of those 14 has annual tax below RM400 — RM5.64 (Firdaus) up to RM163.79
-- (Ameir) — so all of them should be NIL. Syafiq Kaberi is the sharpest case:
-- annual tax RM451.45, less the RM400 rebate = RM51.45, which is already below
-- the RM56.15 he had paid by June, so RM0. Ariff is untouched — RM91,650 of
-- chargeable income is far past the RM35,000 ceiling, which is exactly why he
-- was the one person BrioHR did charge.
--
-- Stored as rows rather than constants so the ceiling and amount are versioned
-- by effective_year alongside the brackets, and a Budget change is a data edit.
-- The code falls back to 400 / 35000 if the rows are absent.
--
-- SQL-managed table (not in schema.prisma). Apply manually via Supabase SQL —
-- hybrid workflow, docs/database-migrations.md. NEVER prisma db push / migrate deploy.

-- NOTE: relief_name is NOT NULL on this table — an INSERT without it fails.
INSERT INTO hr_stat_pcb_reliefs (relief_code, relief_name, amount, effective_year, per_person, notes)
VALUES
  ('REBATE_INDIVIDUAL',     'Individual rebate (ITA s.6A(2))',        400,   2026, false,
   'REBATE, not a relief — comes off the tax charged, not the income. Applies only when chargeable income <= REBATE_MAX_CHARGEABLE.'),
  ('REBATE_MAX_CHARGEABLE', 'Chargeable-income ceiling for s.6A(2)',  35000, 2026, false,
   'Not a relief amount — the ceiling above which the RM400 individual rebate is not given.')
ON CONFLICT DO NOTHING;
