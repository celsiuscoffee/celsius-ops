---
name: hr-module-qa
description: QA the HR module end-to-end (backoffice /hr + staff-facing HR + payroll pipeline). Use when asked to QA/audit HR, after significant HR changes, before arming an HR loop, or when an HR payroll/attendance number looks wrong. Combines code checks with read-only live-data probes.
---

# HR module — QA flow

Latest full run + findings: `docs/design/hr-qa-2026-07-12.md`. Specs of
record: `docs/hr-payroll-spec.md` (note: heavily drifted — see the drift map
in the findings doc before trusting it), `docs/design/people-cost-gating-loop.md`,
`docs/design/ops-performance-loop.md`.

**Hard rule 6 applies everywhere here:** anything that changes computed pay,
tax, or run status in production is propose-only — show the diff/SQL, wait
for approval. Read-only SQL probes against prod are fine and expected.

## Surface map (orient first)

- Admin UI: `apps/backoffice/src/app/(admin)/hr/*` (~25 pages).
- API: `apps/backoffice/src/app/api/hr/*` (~68 routes).
- Logic: `apps/backoffice/src/lib/hr/` — `agents/` (attendance-processor,
  payroll-calculator ×2, schedule-generator, leave-manager, checklist-linker),
  `payroll/` (anomalies, prorate), `statutory/` (formulas + DB-driven
  calculators + PDF/file generators), labour-gate, scope, ot-payroll-sync.
- Staff-facing: `apps/staff` `(ops)/hr/*` + `api/hr/*` (self-scoped);
  `apps/staff-native` `app/(staff)/hr/*` (no availability/OT/swap screens —
  intentionalish gap).
- Data: `hr_*` tables are **Supabase-managed, NOT in schema.prisma**
  (only `HrClaimBatch` is Prisma). Access via `hrSupabaseAdmin`
  (`lib/hr/supabase.ts`). Statutory rates live in `hr_stat_*` tables, not a
  constants file.
- Crons: ~11 HR-touching jobs in `apps/backoffice/vercel.json`
  (attendance-auto-close, review-penalties/sync, overtime-requests/sync,
  deactivate-resigned, hr-compliance-reminder, cert-expiry-reminders,
  labour-variance, ops-review-penalty-eom, ops-nudge-roster, clockin nudge
  via ops-nudges dispatcher, checklist-assign). **None has a heartbeat.**
  Cron budget is 38 — never add one; fold into a dispatcher.

## The flow

### 1. Static checks
- `npm ci --ignore-scripts` at root if sharp's libvips download 403s through
  the egress proxy, then `cd packages/db && npx prisma generate`.
- `npm test` (repo-wide; HR suites are `labour-gate.test.ts` and
  `statutory/formulas.test.ts` — thin coverage, don't over-trust green).
- `cd apps/backoffice && npx tsc --noEmit && npx eslint .`

### 2. Live pipeline probes (read-only SQL, main project kqdc)
Run these and compare against the last findings doc; deltas are the story:
- **Attendance processing:** count `ai_processed_at is null` last 7d and
  `max(ai_processed_at)`. Processor is manual-button-only (HR dashboard →
  `POST /api/hr/attendance/process`) — expect rot unless someone armed it.
- **OT payability:** OT hours this month on logs failing the payroll
  `isOtApproved` predicate (final_status approved/adjusted OR ai_status
  approved w/ null final_status) + pending `hr_overtime_requests` by month.
  Pending OT = OT that pays RM 0 in a run.
- **Payroll runs:** status counts in `hr_payroll_runs`; anything long-stuck
  in draft/ai_computed; `hr_payslips` row count (0 = distribution layer
  still unbuilt; PDFs are on-demand only).
- **Orphans:** scheduled `user_id`s with no `hr_employee_profiles` row
  (labour gate blocks publish on these).
- **Queues:** pending leave, pending shift-swaps (`pending_approval`),
  pending review penalties near month-end, `hr_compliance_events` pending vs
  overdue.
- **Statutory seeds:** `hr_stat_*` sanity (SOCSO/EIS ceiling 6000, EPF 13/12
  @5000, PCB brackets present, EPF_CAP — see Lessons).

### 3. Compute spot-check (when payroll math is in question)
- Statutory: unit tests in `statutory/formulas.test.ts` are the reference;
  cross-check any suspect number against `hr_stat_*` seeds first — rates are
  data, not code.
- Prorate: `lib/hr/payroll/prorate.ts` (calendar-day default).
- Anomalies: `lib/hr/payroll/anomalies.ts` — note the run wizard passes
  empty `priorItems`, so MoM rules never fire in the UI.
- Weekly PT: `payroll-calculator-weekly.ts` pays flat hourly — NO OT
  multipliers, NO statutory, regardless of profile columns. Known, labeled
  drift; don't report as new.

### 4. Access-control spot-check (after touching HR routes)
- Every HR route must import `getSession` from `@/lib/auth` (backoffice
  audience) — never `@celsius/auth`.
- Payroll/salary/bank surfaces: OWNER/ADMIN only.
- MANAGER routes must scope via `lib/hr/scope.ts` — subtree
  (`resolveVisibleUserIds`) for people data, `canAccessOutlet` for
  schedule data. Staff-side routes self-scope to `session.id`.
- Replace-style writers must be insert-first-then-delete (see
  `schedules/cell/route.ts` NON-DESTRUCTIVE REPLACE comment) — never
  delete-then-insert.
- Run-status transitions must carry `.in("status", …)` preconditions +
  409 (see monthly `payroll/route.ts` confirm).

### 5. Report
Findings doc at `docs/design/hr-qa-<date>.md` (prioritized, file:line
evidence, live numbers dated). Money-affecting fixes: propose in the PR
body, don't merge without owner sign-off. Update `docs/STATE.md`.

## Known gaps (don't chase as new bugs)

- `hr_payslips` + `hr_payroll_cycles` tables exist in prod but are dead —
  no code references. Payslip persistence/Cloudinary/viewed_at/badge:
  NOT BUILT; staff payslip pages feature-flagged off (`PAYROLL_UI_ENABLED`).
- Status ladder is `draft → ai_computed → confirmed → paid` (no
  Review/Closed/Void of the spec). Monthly API has no mark-paid action;
  the 6 paid runs were set out-of-band.
- Cadence routing is by `employment_type`, not `payroll_cadence`.
- Profile relief columns and PT OT-multiplier/`statutory_applicable`
  columns are unread by compute.
- PT wages are paid via weekly manual bank transfers (`partimer` GL rule),
  bypassing payroll runs entirely.
- `api/hr/swap` and `api/hr/shift-swaps` both exist (legacy duplicate).
- Three orphaned settings pages unlinked from settings nav
  (allowances, staff-allowances, payroll-items).

## Loop candidates (ranked, from the 2026-07-12 run)

See findings doc §4 for the full list with building blocks. Top of the
stack: monthly payroll close loop (rule-6 gated), OT-approval chase
(unblocks unpayable OT), arming attendance processing on a cron tick,
weekly PT payroll loop, roster generate-and-gate. Whatever ships first
should bring the procurement-style watchdog with it — no HR cron has a
heartbeat today.

## Lessons

- 2026-07-12 — `hr_payroll_cycles` in prod is NOT the spec's cycle table —
  it's an unrelated config shape (one Default row). Don't assume the spec
  schema shipped just because a same-named table exists; grep code for
  actual reads/writes.
- 2026-07-12 — PCB EPF relief: `statutory/calculators.ts` caps
  `annualEpfContribution` at `EPF_CAP` (7000) but 7000 is LHDN's combined
  EPF(4000)+life(3000) cap and life premiums are never added → PCB
  under-withholds for salaries > ~RM3,030/mo. Fix is rule-6 gated (changes
  net pay); if still open, re-flag it.
- 2026-07-12 — Base pay survives the dead attendance processor because
  hours are computed at clock-out and the monthly calculator's filter is
  NULL-safe — but OT approval does NOT survive it; check both before
  declaring payroll healthy.
