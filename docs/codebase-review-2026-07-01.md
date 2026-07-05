# Celsius Coffee — Full Codebase Review (2026-07-01)

Read-only review of the whole monorepo at commit `2cf285f`, run as five parallel
audits: backoffice, customer apps (order / pickup / pickup-native), staff & POS
apps (staff / staff-native / pos-native), the shared foundation (packages + supabase
migrations + tools), and a horizontal security/repo-health sweep. ~1,500 non-test
TS/TSX files + ~2,200-line Prisma schema + 49 SQL migrations.

This is a companion to the 2026-06-12 review (`docs/architecture-restructure-plan.md`).
The structural items that review raised (native apps outside workspaces, triplicated
discount engine, Supabase version skew) are unchanged and not re-litigated here — see
that plan. This review focuses on **correctness and security defects found in the code**.

---

## Overall assessment

The codebase is **better-engineered than typical** for its size: money is integer-sen
end-to-end (no float money in tender paths), MYT/UTC+8 date handling is done correctly
where the dedicated helpers are used, there's a real shared CSRF layer, service tokens
replaced service-role-key-in-header, and the code is unusually well-commented (comments
frequently explain the bug a line is defending against). CI typechecks/lints/tests every
app and guards migrations.

But there is a **consistent, systemic weakness**: authorization is opt-in per route.
All three web middlewares deliberately skip `/api/*` for the session check and apply
only CSRF, so every handler must remember to guard itself — and a meaningful number
don't. This single pattern produced the two most serious findings (unauthenticated
loyalty mutation, unauthenticated order-state machine) and recurs across all the web
apps. The second theme is **money/finance correctness under real Malaysian statutory
rules and under concurrency** — payroll math, GL idempotency, and several read-then-write
races. The third is **RLS/anon-key exposure**: the anon key ships in every client and a
critical storage bucket plus several new tables are readable/writable with it.

Biggest gaps relative to blast radius: HR payroll/statutory math has **zero tests**, and
the customer-facing `order` app has almost no route tests.

---

## CRITICAL

**C1. Entire `/api/pos/loyalty/*` surface is unauthenticated** — `apps/backoffice/src/app/api/pos/loyalty/{redeem,lookup,claim,complete,rewards,snapshot}/route.ts`
No handler imports any auth helper, and middleware skips `/api/*`. All use a service-role
client and take an attacker-supplied `member_id`/`phone`. An anonymous caller can burn any
member's points/vouchers (`redeem`), read full PII for any phone (`lookup` returns phone,
name, tags, points_balance, total_spent, total_visits), claim another member's rewards, and
insert `members` rows / enumerate membership (`lookup?create=1`). The backoffice twin
`/api/loyalty/redeem` correctly calls `requireAuth`; the POS copy omits it.

**C2. Unauthenticated order-state machine → free drinks** — `apps/order/src/app/api/orders/[orderId]/status/route.ts:67`
`PATCH` validates only the state *transition*, never caller identity. Create a real order
via `/api/orders` (returns `orderId`), then `PATCH {status:"preparing"}` — the drink hits
the KDS and is brewed with **no payment settled**. Same hole drives any order to
`ready`/`completed`. Independently flagged by two reviewers.

**C3. Card terminal is a stub that always "approves" and displays a fake approval as real** — `apps/pos-native/lib/maybank-terminal.ts:32`
`chargeMaybankCard()` waits 2.5s and unconditionally returns `{status:"approved", cardBrand:"VISA", maskedPan:"**** 4242", approvalCode:"APR-…"}`. `register.tsx` renders a green "Terminal Approved" card with the fabricated details before the cashier records a completed `card` sale. The approval code/txnRef is never persisted (`lib/checkout.ts:268` writes only method/amount/status), so there's no reconciliation trail. In a busy cafe this trains cashiers to trust the screen and ring up unpaid card sales. (Related: QR tender, `register.tsx:2523`, is also a trust-based tap with no callback/amount-match.)

**C4. `invoices` storage bucket is publicly readable AND writable via the anon key** — `packages/db/prisma/migrations/20260502_storage_public_read_policies/migration.sql:13`
Migration creates `TO public` SELECT/INSERT/**UPDATE** policies on `storage.objects` gated
only on `bucket_id = 'invoices'`. The anon key ships in every client bundle, so anyone can
fetch supplier invoices and proof-of-payment photos (vendor bank details), upload arbitrary
objects, and **overwrite existing invoice evidence**. Contrast `063_hr_photos_private.sql`,
which locked selfies down for exactly this reason.

**C5. Bukku feed rebuild wipes GL idempotency stamps → same bank lines re-posted ~4×/day** — `apps/backoffice/src/lib/finance/bukku-feed-sync.ts:140`, `gl-posting.ts:61`
`syncAccount` does `bankStatement.deleteMany({where:{notes:FEED_NOTE}})` then recreates lines;
`BankStatementLine` cascades on delete, so lines previously stamped `glTransactionId` are
recreated with `glTransactionId:null`. The same cron's step 4 then books every "unstamped"
line as a **new** journal into `fin_transactions` (a separate store the delete doesn't touch).
Duplicate journals accumulate every 6h until the PDF anchor advances; nothing reverses them.
The rebuild also un-links `apInvoiceId` on settled invoices.

**C6. Payroll compute/confirm is non-atomic and unconstrained → duplicate confirmed runs corrupt YTD PCB** — `apps/backoffice/src/lib/hr/agents/payroll-calculator.ts:32`, `api/hr/payroll/route.ts:115`
Compute is 5 separate statements with no transaction or unique constraint; two concurrent
`compute` calls both create `ai_computed` runs for the same period. `confirm` checks neither
current status nor an existing confirmed run, so both duplicates confirm (and a `paid` run can
silently downgrade). YTD-for-PCB sums items across confirmed/paid runs, so duplicates double
YTD gross/PCB and skew every subsequent month's tax.

---

## HIGH

**H1. SECURITY DEFINER RPCs are anon-executable (no REVOKE anywhere)** — `supabase/migrations/018_...:30`, `022_reconcile_pos_loyalty.sql:12`
`create_pos_sale(jsonb)` and `reconcile_pos_loyalty(int)` are `SECURITY DEFINER` but no migration
grants/revokes EXECUTE, so Postgres's default PUBLIC grant makes them callable via PostgREST with
the anon key. Fake completed sales + a `loyalty_phone` → real loyalty points to an attacker-controlled
member. Needs `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated; GRANT … TO service_role;`.

**H2. Recent tables shipped without RLS, including one holding recovery voucher codes** — `supabase/migrations/053_review_reply_drafts.sql`, `034_grab_webhook_events.sql`, `038_challenge_nudge_holdout.sql`, `033/035/036/056/057`
Only 3 of 10 table-creating migrations enable RLS. `ReviewReplyDraft` (RLS off) holds
single-use compensation-voucher `recoveryCode`s → anyone with the anon key can read pending codes
and mint recovery vouchers. `grab_webhook_events.raw` holds customer names/phones. All are also
anon-*writable* under default grants. The deny-all-RLS-no-policy pattern in `038_sms_loops.sql`
should be the default on every new table.

**H3. Anon key can write sales, shifts, and settings from the POS** — `apps/pos-native/lib/checkout.ts:60`, `shift.ts:84`, `use-pickup-printer.ts:268`
The APK-embedded anon key (extractable) performs state-changing writes with no user auth:
insert/close/**reopen** `pos_shifts`, bump `pos_branch_settings.queue_counter`, stamp
`kitchen_docket_printed_at`, and call `create_pos_sale`. Anyone with the key can forge completed
sales (polluting Z-reports + triggering loyalty accrual), close/reopen any shift, or suppress
kitchen dockets. PIN auth is a separate API check that never gates these DB writes.

**H4. Unauthenticated staff/dashboard data endpoints leak business data + PII** — `apps/order/src/app/api/staff/orders/route.ts:5` (+ `feed`, `overdue-count`, `products`, `availability`); `apps/staff/src/app/api/dashboard/route.ts:4` (+ `products/options`, `outlets`, `settings/stock-count`); `apps/backoffice/src/app/api/inventory/pay-and-claim/route.ts` GET, `settings/approval-rules` GET, `loyalty/promotions` GET, `ops/audit-templates` GET
Store slugs are guessable; anonymous callers enumerate full order feeds, wastage/PO totals,
supplier names, reimbursement claims, and approval thresholds. All are omissions, not design —
sibling routes in the same apps guard correctly.

**H5. Module-level authorization is enforced only in the sidebar UI, not on APIs** — `apps/backoffice/src/lib/auth.ts:141`
`hasModulePermission` is wired into only 2 route files. Most routes use `requireAuth`/`requireRole`,
which admit any MANAGER-tier token. A MANAGER granted only `inventory` in `moduleAccess` can directly
`POST /api/loyalty/promotions`, hit HR endpoints, etc. — the nav hiding is cosmetic.

**H6. POS PIN login + manager-override verify have no rate limiting → PIN brute-force** — `apps/backoffice/src/app/api/pos/auth/pin/route.ts:175`, `verify-manager/route.ts:16`
Neither calls `checkRateLimit` (the password login does). Both are unauthenticated; `pin` accepts
a 6-digit PIN checked against all active users, `verify-manager` gates voids/refunds on a 4+ digit PIN.
Online brute force of the numeric space is open. (Staff-web `pin` also discloses other users' names on
duplicate-PIN 401s and bcrypts every user's hash per attempt — `apps/staff/src/app/api/auth/pin/route.ts:53`.)

**H7. Malaysian statutory payroll math is systematically wrong (SOCSO/EIS/EPF/PCB)** — `apps/backoffice/src/lib/hr/statutory/calculators.ts`
Multiple independent errors that make filings not reconcile:
- SOCSO/EIS charged on the bracket **ceiling** not the PERKESO band **midpoint** (`:76,108`) → every employee over-deducted ~half a band/month.
- SOCSO/EIS wage basis **excludes overtime** (`payroll-calculator.ts:420`), but PERKESO wages include OT → under-contribution for anyone with OT.
- EPF uses a flat `ceil(wage/20)*20` (`:41`); KWSP Third Schedule uses RM100 bands above RM5,000 → contributions understated above RM5k.
- Rates/PCB brackets resolved at `new Date()` execution time, not the payroll period (`:26,120,290`) → recomputing Dec payroll in Jan uses next-year brackets.
- PCB rounding uses nearest-5-sen with no RM10 nil-floor (`:249,353`); LHDN requires round-**up** to 5 sen and nil below RM10.

**H8. Payroll month/attendance windows compared in UTC, not MYT** — `apps/backoffice/src/lib/hr/agents/payroll-calculator.ts:110`
`clock_in` is UTC timestamptz but the pay-period filter uses bare date strings (UTC midnight).
Shifts clocking 00:00–08:00 MYT on the 1st fall into the previous month (OT paid wrong period).
Cross-month unpaid leave (e.g. 28 Jun–5 Jul) matches neither month's `start>=… AND end<…` filter and
is never deducted → overpayment. The allowance engine uses correct `+08:00` bounds; the calculator doesn't.

**H9. GL poster is non-atomic across two databases with no concurrency guard → double-posted journals** — `apps/backoffice/src/lib/finance/gl-posting.ts:117`, `ledger.ts:56`
`postJournal` (Supabase) then `bankStatementLine.updateMany` (Prisma) are two stores with no shared
transaction and no claim/lock. A crash between them leaves lines unstamped for the next cron to re-post;
manual `/api/finance/gl-post`, `/api/cron/gl-post`, and the bukku step can run concurrently and all post
the same lines. `reverseTransaction` is check-then-act, so overlapping calls post two reversals.

**H10. Weekly payroll PATCH has no run-status guard and overwrites `net_pay = gross`** — `apps/backoffice/src/app/api/hr/payroll/weekly/route.ts:163`
Unlike the sibling adjustment routes, this PATCH never checks run status (items of confirmed/paid runs
editable after bank files generate), doesn't verify the item belongs to a weekly run, and unconditionally
writes `net_pay: newGross` — pointed at a monthly item it erases EPF/SOCSO/EIS/PCB from net pay.

**H11. Session revocation (`tokenRevokedAt`) is dead code despite schema claiming otherwise** — `packages/auth/src/require-auth.ts:104`, `jwt.ts:36`, `schema.prisma:149`
The schema comment says requireAuth checks JWT `iat` against `tokenRevokedAt` (12h panic button /
password-change revocation), but every auth path calls plain `verifyToken`; `verifyTokenWithFreshness`
is exported and never imported. A stolen session stays valid for its full lifetime (7d backoffice / 12h
staff) even after sign-out-all.

**H12. Offline dead-lettered sales are invisible → paid orders can silently vanish** — `apps/pos-native/lib/offline-queue.ts:113`
After 5 rejections a buffered sale is moved to a dead-letter AsyncStorage key, but `listDeadLetter()` is
never called anywhere — no screen, badge, or alert. The customer paid and got a receipt, but the sale
exists only in a hidden blob on one device; a reinstall/factory-reset destroys it.

**H13. Test coverage: money/payroll modules have zero tests** — `apps/backoffice/src/lib/hr/payroll/*`, `hr/statutory/*`
27 test files total, concentrated in finance parsers, grab logic, inventory, and the loyalty discount
engine. The Malaysian statutory calculators (EPF/SOCSO/EIS/PCB) and payroll proration — the exact code in
H6/H7 — have no tests. The customer-facing `order` app ships almost no route tests.

---

## MEDIUM (selected)

- **M1. Client-supplied line prices persisted to the DB** — `apps/order/src/app/api/{orders,checkout/initiate}/route.ts` — charged total is correctly recomputed server-side, but `order_items.unit_price`/`item_total` use client `item.totalPrice`, corrupting the stored breakdown and reporting.
- **M2. Three parallel re-implementations of pricing** — `apps/order` `orders` / `checkout/initiate` / `checkout/quote` each copy ~700 lines of subtotal+SST+discount+promo logic ("mirrors initiate/orders" per comments). Should be one shared helper.
- **M3. Order-number generators collide and disagree** — `apps/order/api/orders/route.ts:62` uses `C-${random 0-9999}` against a UNIQUE column (birthday-paradox insert failures); `checkout/initiate` uses a different timestamp scheme. POS `getNextQueueNumber` (`pos-native/lib/checkout.ts:299`) is a non-atomic read-then-write → duplicate queue numbers.
- **M4. `verifyToken` does no payload/audience validation** — `packages/auth/src/jwt.ts:23` — a `celsius-service`-audience token (same secret) passes `verifyToken` and yields a "user" with undefined id/role; any route checking only truthiness accepts it.
- **M5. Payment-gateway secrets stored plaintext on `Outlet`, exposed via a customer-facing view** — `schema.prisma:64` — `staffPin`, `rmClientSecret`, `rmPrivateKey`, `bukkuToken` as plain columns on a model the comment says is exposed through the `outlets` view.
- **M6. Verbose Stripe key diagnostics returned to unauthenticated clients** — `apps/order/api/checkout/create-payment-intent/route.ts:188` — error/GET responses include `keyPrefix`, `keyLen`, Stripe account id/country.
- **M7. OTP verify is non-atomic (replayable in a race) and codes stored plaintext** — `packages/shared/src/otp.ts:120` — SELECT→compare→UPDATE lets one code authenticate twice. Hardcoded reviewer bypass (`60111111111`/`424242`) is a permanent static credential.
- **M8. `createSupabaseAdmin` silently falls back to the anon key** — `packages/shared/src/supabase.ts:26` — a missing service-role key in prod runs "admin" queries as anon (empty-data bugs) instead of failing loud.
- **M9. Loyalty reveal/claim are check-then-act races (double payout)** — `apps/backoffice/api/pos/loyalty/claim/route.ts:167` — reveal pays out then stamps `revealed_at` last; admin-claimable does non-atomic `total_claimed+1`, overshooting `max_claims`. Amplified by C1 (unauthenticated/unthrottled).
- **M10. Z-report excludes offline sales that sync after shift close** — `apps/pos-native/lib/shift.ts:60` — `closeShift` snapshots cloud-visible totals; buffered sales sync later with the closed `shift_id` and nothing recomputes the rollup.
- **M11. UTC-vs-MYT boundaries in staff routes, cashflow forecast, and pickup opening-hours** — `apps/staff/api/hr/shifts|whos-away|dashboard|invoices|availability|stock-checks`, `apps/backoffice/src/lib/finance/cashflow.ts:194`, `apps/order/api/orders/route.ts:188` — "today"/"this month"/opening-window computed in UTC on a UTC server; correct MYT helpers exist but weren't applied.
- **M12. Write-on-GET side effects** — `apps/backoffice/api/inventory/receivings/route.ts:9` — a list fetch runs a non-idempotent N+1 auto-reconcile that updates order statuses, with no auth on the GET.
- **M13. Bank-statement CSV upload not idempotent** — `apps/backoffice/api/finance/bank-statements/route.ts:74` — `createMany({skipDuplicates:true})` is a no-op (no unique constraint on `BankStatementLine`); re-upload double-counts and feeds duplicate GL journals. LLM AP-verifier is shown the invoice amount as the bank amount (`ap-verifier.ts:34`), hiding the discrepancy it exists to catch.
- **M14. Native session JWT stored in plaintext AsyncStorage** — `apps/staff-native/lib/session.ts:1` — 12h Bearer token in unencrypted storage; `expo-secure-store` (Keystore) is already an available drop-in.
- **M15. CSRF blanket exemption for any `/api/**/{webhook,callback}` path** — `packages/shared/src/csrf.ts:47` — name-based, not auth-based; a future cookie-authed route named `.../callback` silently loses CSRF protection.
- **M16. Native cart uses floating-point money for quantity edits** — `apps/pickup-native/lib/store.ts:255` — `(totalPrice/quantity)*qty` accumulates rounding error; the order-app store recomputes cleanly from base price.

---

## LOW / hygiene (selected)

- `docs/rls-strategy.md` is badly stale (says 2 tables have RLS; the May-02 migration records 117/141) and doesn't document the deny-all-RLS expectation for new tables — H2 keeps recurring partly because of this.
- Duplicate migration prefix `038` (two files); migrations 001–017 absent from the repo so SQL history can't rebuild from scratch; several schema comments admit live drift.
- `apps/pickup` (Capacitor shell) is superseded by `pickup-native` but still ships and has a built `out/` committed to the repo.
- Root `package.json` `typecheck:apps` references non-existent `apps/loyalty`; the script errors if run.
- `getUserFromHeaders` is a no-op kept exported (and re-exported through `apps/staff`) — a trap for the next route author.
- Canonical helpers still duplicated in apps: 3× `mytToday`, 2× `formatRM` (disagreeing on sen vs RM units), 4× `haversineDistance`, hardcoded outlet-code tables in the POS binary.
- `verifyPassword` throws `RangeError` (→ 500) instead of returning false on a malformed stored hash — `packages/auth/src/password.ts:36`.
- `Math.random()` v4 UUIDs used as cross-fleet sale idempotency keys — a collision silently discards the second sale (`pos-native/lib/offline-queue.ts:146`).
- print-bridge: unbounded request body (local OOM) and caller-directed raw TCP target with no allowlist (`tools/print-bridge/server.js:236,270`).
- Several 1,000–3,300-line client page components; 152/155 backoffice pages are `"use client"` (RSC barely used); no dependency/secret scanning in CI.

---

## Suggested remediation order

1. **Close the unauthenticated write/read holes first** (C1, C2, H3, H4) — exploitable with no credentials, and C1/C2/C4 expose PII or give away product/money. Add auth to the POS-loyalty and order-status routes; lock the `invoices` bucket; REVOKE the DEFINER RPCs (H1) and enable RLS on the new tables (H2).
2. **Stop the finance ledger from corrupting itself** (C5, H9) — the GL re-posts duplicates today; this is silently accumulating bad data every 6h.
3. **Fix payroll before the next run** (C6, H7, H8, H10) — the statutory math produces legally-incorrect Malaysian filings; write characterization tests (H13) as the acceptance gate.
4. **Structural fix for the auth pattern** — move module-authorization enforcement server-side (H5) and consider a default-deny middleware allowlist instead of the per-route opt-in that caused most of the above.

## What's genuinely solid (don't regress these)
Server-authoritative charge recomputation with modifier clamping in `order`; RM webhook re-queries
the gateway for truth (spoofed callbacks can't mark paid); idempotent payment side-effects in `after()`;
integer-sen money throughout; noon-MYT-anchored date helpers; migration 018's advisory-lock order-number
recovery; fail-closed `checkCronAuth`; the double-clock-in partial unique index; well-written Kotlin native
modules with proper resource cleanup; strong `packages/ui` a11y baseline.
