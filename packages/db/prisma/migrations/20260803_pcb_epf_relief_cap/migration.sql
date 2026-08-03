-- PCB: correct the EPF relief cap from RM7,000 to RM4,000.
--
-- LHDN splits this relief: RM4,000 for EPF/approved-scheme contributions and
-- RM3,000 for life insurance / takaful. RM7,000 is the total only when BOTH are
-- claimed. hr_stat_pcb_reliefs carried 7,000 under EPF_CAP and calcPCB applies it
-- as min(annualEpfContribution, cap) — so the combined ceiling was granted against
-- EPF alone, with no life-insurance figure anywhere in the system.
--
-- Effect: every employee contributing more than RM4,000 EPF a year had RM3,000 too
-- much relief, understating chargeable income and therefore PCB. 3 of the 27 lines
-- on the Jul 2026 run, all of them PCB payers. For Ariff (RM10,500/mo, 25% marginal)
-- it is RM750/year — RM125.00/month.
--
-- Verified against BrioHR: with this cap plus the YTD fix in payroll-calculator.ts,
-- Ariff's July 2026 PCB reconciles to RM1,054.15 — BrioHR to the cent.
--
-- If a life-insurance relief is ever collected (TP1), add it as its own relief code
-- capped at 3,000. Do NOT raise EPF_CAP back to 7,000 to approximate it.
--
-- SQL-managed table (not in schema.prisma). Apply manually via Supabase SQL —
-- hybrid workflow, docs/database-migrations.md. NEVER prisma db push / migrate deploy.

UPDATE hr_stat_pcb_reliefs
SET amount = 4000
WHERE relief_code = 'EPF_CAP'
  AND effective_year = 2026
  AND amount = 7000;
