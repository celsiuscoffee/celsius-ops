# RLS access-path map — 2026-07-05

Verified map of who touches the sensitive tables from `docs/rls-strategy.md`,
and what RLS actually covers today. Supersedes that doc's "where we stand"
section, which is stale (see corrections below). Evidence gathered by
code/migration sweep on this date.

> **⚠️ Live-DB correction (same day, evening):** this map was built from the
> repo's migration files, and the live database (kqdcdhpnyuwrxqhbuyfl) had
> drifted **ahead** of them. Verified against `pg_policies` +
> `role_table_grants` directly:
> - **Exposure 1 below was already fixed in production** — the `USING (true)`
>   policies are gone, anon's DML grants on members / member_brands /
>   point_transactions / redemptions / otp_codes are revoked (permission
>   denied before RLS applies), and `staff_users` no longer exists. The
>   proposal SQL is superseded (marked in-file).
> - **`hr_payroll_runs` already has RLS enabled** (deny-all) — exposure 3 is
>   closed too.
> - The **real live exposure was `public.outlets`**: a postgres-owned VIEW
>   over `"Outlet"` without `security_invoker` (writes bypass RLS), with
>   full anon/authenticated DML grants — an anon-key write path into outlet
>   master config. **Fixed 2026-07-05**:
>   `supabase/migrations/073_revoke_anon_writes_outlets_view.sql`.
> - Exposure 2 (pickup page browser reads) was real but manifested as the
>   loyalty/inventory tabs silently returning nothing (deny-all), not as a
>   data leak; the server-side route shipped in #782 fixes the loyalty tab.
>   The inventory tab reads tables (`ingredients`, `stock_levels`) that
>   exist in NEITHER Supabase project — pre-existing dead feature, still
>   returning empty via the new route.
> - Lesson: **audit the live database, not migration files.** The weekly
>   rls-audit routine now includes a live `pg_policies`/grants/views check.

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

## Live advisor snapshot — 2026-07-05 (get_advisors, project kqdcdhpnyuwrxqhbuyfl)

Running Supabase's own security linter surfaced a wider surface than the
code sweep. Totals: 30 ERROR, 44 WARN, 187 INFO.

**Fixed this session (verified live):**
- `outlets` view — anon/authenticated DML revoked
  (`073_revoke_anon_writes_outlets_view.sql`).
- 10 dated snapshot/soft-delete tables — deny-all RLS enabled
  (`074_enable_rls_backup_snapshot_tables.sql`).

**Fixed 2026-07-05 (batch 2, migration 075) — all 14 remaining
anon-reachable tables locked:** `PendingPop` (POP `token`; Prisma-only
writer, RLS-exempt), grab_* (webhook_events/reconcile_runs/campaigns/
ads_spend/modifier_links), ads_* (budget_change/search_term_daily/
term_exclusion), poster_events + pos_poster_perf, challenge_nudge_assignment,
product_*_seed. All verified server-only (no native/browser/client-component
anon access). Deny-all, zero app impact.

**Post-batch advisor state (verified):** `rls_disabled_in_public` 24 → **0**;
`sensitive_columns_exposed` 2 → **0**; security ERRORs 30 → **4**.

**Still open — deliberately not touched:**

| Finding | Why left | Note |
| --- | --- | --- |
| 14× `rls_policy_always_true` on `pos_*` + `orders` | **the SUNMI till architecture** — registers write via the anon key by design | do NOT revoke without a data-layer plan (rls-strategy.md Path A); this is the POS hot path |
| 4× `security_definer_view` (`unified_sales`, `unified_sale_items`, `pos_pair_upsell_report`, `outlets`) | hardening; `outlets` write path already revoked (073) | convert to `security_invoker` when convenient |
| ~12× `function_search_path_mutable`, `pg_net` in public, exposed materialized view | low-risk hardening | next pass |

The `pos_*` always-true policies are load-bearing: the tills authenticate
with the anon key and INSERT/UPDATE orders/payments/shifts directly.
Tightening them means moving those writes behind a server API (Path A's real
cost) — a project, not a migration. Flag, don't touch.

## Proposed order of work

1. New backoffice API route for the pickup page's loyalty reads; switch the
   page to it. (Code-only, no approval gate.)
2. Migration: scope the four loyalty policies to `service_role`.
   (**Human approval — production DB.**)
3. Migration: deny-all on `hr_payroll_runs` + the PascalCase ops tables.
   (**Human approval — payroll table.**)
4. Rewrite `docs/rls-strategy.md` against real table names and current
   coverage; then re-run this sweep (or the `rls-audit` workflow) to verify.
