# RLS access-path map — 2026-07-05

Verified map of who touches the sensitive tables from `docs/rls-strategy.md`,
and what RLS actually covers today. Supersedes that doc's "where we stand"
section, which is stale (see corrections below). Evidence gathered by
code/migration sweep on this date.

## Corrections to `rls-strategy.md`

1. **"Only `orders`/`order_items` have RLS" is outdated.** Three later
   migration sets already enable RLS more widely:
   - `packages/db/prisma/migrations/20260502_rls_sensitive_tables/migration.sql`
     — deny-all RLS on 27 tables (BankStatement/Line, hr_attendance_pings,
     hr_payroll_cycles, hr_payslips, salary/overtime, ads_*).
   - `supabase/migrations/064_rls_hr_attendance_logs.sql` — deny-all on
     `hr_attendance_logs`.
   - `apps/backoffice/supabase/migrations/002_finance_module.sql:515-553` —
     RLS on all `fin_*` tables with a proper `fin_read` policy
     (`to authenticated`, gated on `fin_user_roles`).
2. **Several doc table names don't exist.** Real names: `point_transactions`
   (not `transactions`/`points_history`), `hr_attendance_logs`/`hr_payroll_runs`
   (not `attendance`/`payroll_runs`), Prisma PascalCase `AuditReport`,
   `Checklist`, `BankStatement`, `BankStatementLine`.

## Ranked exposures

### 1. CRITICAL — loyalty tables are effectively public despite RLS "on"

`apps/order/supabase/migrations/001_initial_schema.sql:168-195` enables RLS
on `members`, `member_brands`, `point_transactions`, `redemptions`, but the
"Service full access" policies (lines ~186-195) are
`FOR ALL USING (true) WITH CHECK (true)` **without `TO service_role`** —
they apply to every role, including `anon`. Anyone holding the published
anon key can read **and write** full member PII and points balances. No
later migration tightens these.

**Fix:** recreate those four policies scoped `TO service_role` (or drop
them — service_role bypasses RLS anyway) and add explicit narrow policies
if any client-side read is still needed. One SQL migration; needs human
approval + coordination with exposure 2 (which this fix will break).

### 2. HIGH — backoffice pickup page queries loyalty tables from the browser

`apps/backoffice/src/app/(admin)/pickup/page.tsx` (a `"use client"`
component) queries `member_brands` (lines ~192-202) and `redemptions`
(~195) directly with the anon key via `lib/pickup/supabase.ts`. It works
*only because of exposure 1*, and will break the moment the policies are
fixed. **Fix first:** move these reads behind a backoffice API route
(service-role, server-side), then apply the policy fix.

### 3. MEDIUM — `hr_payroll_runs` has no RLS

Sibling HR tables got deny-all RLS in `20260502_rls_sensitive_tables`, but
`hr_payroll_runs` (salary data) was missed — anon-reachable via PostgREST.
No app code reads it with the anon key, so exposure is latent, not active.
Fix: add to the deny-all set (one-line migration; payroll — human approval).

### 4. LOW — Prisma ops tables without RLS

`AuditReport`, `Checklist` (+ related PascalCase tables): no RLS, latent
anon-reachability via PostgREST; all code access is Prisma server-side.
Fold into the next deny-all batch.

## Access-path map (compact)

| Table(s) | Server-side access | Client-side access | RLS state |
| --- | --- | --- | --- |
| `members`, `member_brands`, `redemptions`, `point_transactions` | order + backoffice API routes, loop-engine, reviews recovery (service-role) | **backoffice pickup page (browser, anon)** | ON but `USING (true)` all roles → ineffective |
| `push_subscriptions` | order push routes (service-role) | none | ON, deny-all ✓ |
| `hr_attendance_logs`, `hr_attendance_pings` | staff + backoffice HR routes, HR agents (service-role) | none | ON, deny-all ✓ |
| `hr_payroll_runs` | backoffice payroll routes + payroll-calculator agents | none | **NONE** |
| `AuditReport`, `Checklist` | staff + backoffice ops routes (Prisma) | none | none (latent) |
| `BankStatement`, `BankStatementLine` | backoffice finance routes (Prisma) | none | ON, deny-all ✓ |
| `fin_*` (all) | backoffice finance client (service-role) | none | ON with scoped `fin_read` ✓ — best in repo |

Native apps (`pos-native`, `pickup-native`, `staff-native`) touch none of
these tables — their anon clients read POS/catalog tables only.

## Proposed order of work

1. New backoffice API route for the pickup page's loyalty reads; switch the
   page to it. (Code-only, no approval gate.)
2. Migration: scope the four loyalty policies to `service_role`.
   (**Human approval — production DB.**)
3. Migration: deny-all on `hr_payroll_runs` + the PascalCase ops tables.
   (**Human approval — payroll table.**)
4. Rewrite `docs/rls-strategy.md` against real table names and current
   coverage; then re-run this sweep (or the `rls-audit` workflow) to verify.
