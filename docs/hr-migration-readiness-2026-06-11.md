# HR Module — BrioHR Migration Readiness Report

**Date:** 2026-06-11 · **Target cutover:** July 2026
**Scope:** BrioHR ↔ HR module cross-check (data + feature parity) and full QA (payroll engine, leave, attendance, OT, security). Code audit on `celsius-inventory` + live DB verification on Supabase `kqdcdhpnyuwrxqhbuyfl`. BrioHR side from April 2026 exports (no API credentials exist; web session logged out — live pull pending login).

---

## Verdict

**Not ready to cut over today — but the gap list is short and concrete.** The payroll statutory engine is fundamentally sound (EPF/SOCSO/EIS/PCB structures verified correct against current law). The two things that would actually hurt in July are: (1) **the staff app's entire HR surface has been dead since the 2026-05-20 RLS lockdown**, and (2) **approved OT never reaches payroll**. Everything else is a fix-list, a data-cleanup list, and one BrioHR import (YTD figures) that must happen before the first live run.

---

## A. Cross-check: BrioHR vs HR module

| Area | Result |
|---|---|
| Employee roster | ✅ All 27 BrioHR (April) staff exist in module; module is ahead (58 profiles, 48 active, incl. May/June joiners BrioHR doesn't have) |
| Payroll item catalog | ✅ 1:1 — all 90 items, identical PCB/EPF/SOCSO/EIS/HRDF flags and EA-form fields |
| Statutory rate tables | ✅ Seeded and correct (EPF Cat A/B/C per post-Dec-2024 law, SOCSO bands, EIS, PCB 2026 brackets) — except PCB EPF-relief cap seeded **7000, must be 4000** (B2) |
| Leave types | ⚠️ 6 policies vs BrioHR's set: **no Paternity Leave** (statutory 7 days since 2023); flat AL 8d / MC 14d ignores EA tenure tiers (8/12/16 AL, 14/18/22 MC) — Syafiq (2021) is owed 16 AL days |
| Leave balances | ⚠️ 39 rows vs ~288 expected (48 staff × 6 types); no annual seeding/rollover job; carry-forward config stored but never executed |
| Public holidays | ⚠️ 11 rows for 2026: missing New Year, CNY day 2, Wesak, Awal Muharram, Maulidur Rasul + all state days (Selangor/Putrajaya/Cyberjaya/N9); "Ramadan Begins" (Feb 18) is not a PH — likely mislabeled CNY day 2. Drives 3× OT pay, so errors are money errors |
| Payroll history | ⚠️ Module has Jan–Mar 2026 runs `paid`, Apr+May only `ai_computed` (never confirmed). **YTD gross/PCB from runs actually paid via BrioHR (Jan–Jun) must be imported before July**, or mid-year PCB and EA forms will be wrong |
| Claims | BrioHR claims → module: claims flow exists in staff app (separate module, HrClaimBatch); open BrioHR claims must be settled or re-keyed at cutover |
| Attendance/roster | ✅ Module is already the source of truth (508 logs, 1,192 shifts, geofence live) — BrioHR timesheets stale since April |
| **Pending live BrioHR pull** | Current leave balances per staff, YTD payroll register Jan–Jun, open claims. Blocked: no API creds (`~/.briohr_env` missing; access request email was drafted, never fulfilled) and web session logged out. **Action: log into app.briohr.com in Chrome and I can pull these.** |

## B. Blockers (must fix before cutover)

1. **B1 — Staff app HR routes dead since RLS lockdown (2026-05-20).** hr_* tables are deny-all RLS, but `apps/staff` routes for leave, payslips, OT, memos, attendance history, shifts, swap, availability, who's-away still use the anon-key client → empty lists / 500s / "Memo not found". Production proof: zero leave/OT submissions since May 20; last leave request 2026-04-18. Only `hr/clock`, `hr/attendance/ping`, `hr/profile` were migrated to `supabaseAdmin`. Fix = migrate remaining routes to service-role + `session.id` scoping (pattern exists).
2. **B2 — PCB EPF relief cap seeded RM7,000; LHDN MTD formula caps at RM4,000** (`hr_stat_pcb_reliefs` EPF_CAP + fallback in `calculators.ts:195`). Tax under-deducted for anyone above ~RM3,030/mo. One-line data+code fix, then re-check Jan–Mar paid runs.
3. **B3 — Approved OT never reaches payroll.** Monthly payroll reads OT from `hr_attendance_logs` final status; the OT-request approval queue (`hr_overtime_requests`) never writes back, and weekday-OT logs are filtered out of the attendance review queue. Manager approves OT → staff paid RM0 OT. (81 OT requests in prod.)
4. **B4 — BrioHR YTD import** (see table above) — required for correct PCB from the first live run.

## C. High-priority (fix before or at cutover)

- **H1 — Approve gate is client-side only.** `action=confirm` API does zero checks; legacy + weekly pages skip anomalies entirely; 3 of 6 anomaly rules can never fire (prior items hardcoded `[]`, profile passed without `resigned_at`). Spec's BLOCK rules (missing bank, negative net, resignation-not-prorated) are not enforced server-side.
- **H2 — Public-holiday work inside normal hours pays zero premium** (EA s.60D 2× never paid; only beyond-threshold 3× OT pays).
- **H3 — Part-timer weekly payroll**: hardcodes all statutory to 0 (EPF/SOCSO have no de-minimis threshold — 18 active PTs uncovered), pays scheduled hours not actuals, OT hardcoded 0, spec's `statutory_applicable` toggle unimplemented, **zero weekly runs ever executed in prod** — untested flow weeks before it goes live.
- **H4 — Joiner/leave window bugs**: future joiners get full month's pay; unpaid leave spanning a month boundary is never deducted (both months miss it).
- **H5 — Leave engine**: no balance seeding/rollover job; `init_all` re-run wipes used/pending; staff POST accepts negative `total_days` (balance inflation); policy rules (advance days, attachments, blackouts) stored but never enforced; AI-approved leave never lands in `used_days`; no cancellation flow; calendar-day counting (weekends/PH count as leave); no half-day.
- **H6 — Geofence clock-in is a hard 403 block** — company policy is warn + allow-skip + audit; the audit path exists but is unreachable.
- **H7 — No unit tests for any payroll/statutory math.** Vitest is configured; add a suite for `calculators.ts` + `prorate.ts` against published KWSP/PERKESO/LHDN values before first live run.

## D. Medium / data cleanup

- SOCSO/EIS use band upper bound not PERKESO midpoint (~RM0.25/employee/mo off vs ASSIST); SOCSO/EIS basis excludes OT but PERKESO (and our own catalog) includes it; EPF bracket steps wrong above RM5k (RM20 steps used; schedule is RM100).
- Attendance month window is UTC not MYT — clock-ins before 8am on the 1st land in the prior month (recurring: 4 hits in last 90 days).
- Payslips: `hr_payslips` dead table (0 rows, 5 runs); staff payslip page works but shows inline breakdown, no PDF; Cloudinary storage + `viewed_at` + badge unbuilt. Bank file is "Maybank M2u Biz IBG" — format unvalidated with bank; EPF file exports `basic_salary` as wage while contributions use statutory basis (portal mismatch risk).
- Ad-hoc adjustments (e.g. bonus) never recompute statutory — EPF-liable bonuses carry zero EPF.
- Profile relief columns (`spouse_relief` etc.) are dead — reliefs only flow via TP3 `hr_employee_tax_reliefs`; HR filling the profile Statutory tab does nothing.
- `hr-photos` bucket is PUBLIC — clock-in selfies (biometric PII) exposed by URL. Make private + signed URLs.
- Fail-open cron auth on `overtime-requests/sync` + `review-penalties/sync` (run unauthenticated if `CRON_SECRET` unset).
- **Data completeness (48 active):** 24 missing IC, 12 FT missing EPF no., 13 FT missing SOCSO no., 15 missing bank account, 3 FT with RM0 basic salary (incl. Firdaus). `statutory_applicable` is dead schema — ignore the all-false values (monthly calc doesn't read it).
- Apr + May runs stuck `ai_computed` — confirm or void before July so YTD chain is clean.

## E. Verified safe (don't re-litigate)

EPF/SOCSO/EIS/PCB rate structures & 2026 brackets; OT floor policy (monthly path) + 1.5/2/3× mapping; prorate engine math (calendar-day, joiner/resigner/unpaid priority, variable pay not prorated); run locking (no recompute of confirmed/paid); RBAC on all 65 backoffice HR routes (payroll/salary = OWNER/ADMIN; MANAGER stripped of PII; fail-closed manager subtree scoping); staff object-level auth (no IDOR found); RLS deny-all backstop on all 49 hr_* tables; documents vault private + signed URLs; attendance auto-close cron fail-closed and midnight-safe; payroll item catalog parity with BrioHR.

## F. Recommended cutover sequence

1. **This week:** Fix B1 (staff routes → service-role), B2 (EPF cap 4000 + re-check Jan–Mar PCB), B3 (OT approval → payroll), H6 (geofence soft-block). Make `hr-photos` private.
2. **Next week:** H1 server-side approve gate + real anomaly inputs; H2 PH pay; H4 window bugs; statutory unit tests (H7); decide part-timer statutory policy (H3) and run one shadow weekly cycle.
3. **Data week:** Log into BrioHR → pull live leave balances + YTD payroll register + open claims → seed `hr_leave_balances` (all staff × types, with carry-forward), import YTD, fix missing IC/EPF/SOCSO/bank/salary fields, fix holiday table (gazetted national + Selangor/Putrajaya/N9), add Paternity policy + tenure-tiered AL/MC.
4. **Shadow run:** June payroll computed in BOTH systems; reconcile to the ringgit (expect the known SOCSO/EIS band-midpoint deltas). Confirm or void Apr/May `ai_computed` runs.
5. **Cutover:** first week of July — weekly PT run Monday, monthly run end-July. Keep BrioHR read-only for one more month (EA-form source) before cancelling.

## G. Out-of-scope notes

- Supabase advisory: 9 non-HR tables have RLS disabled (`*_backup_20260606`, `product_*_seed`, `point_txn_deleted_20260606`, `member_brands_adj_20260606`). Backup/seed tables, but anon-writable — enable RLS (no policies needed) when convenient.
