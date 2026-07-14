# STATE — cross-session memory

Working memory for agent sessions on this repo. Read this at the start of every
session; update it before ending one. Keep entries dated, terse, and factual —
delete entries that have been promoted into `CLAUDE.md`, a skill, or a doc.

## Verified facts

- 2026-07-12 — **Data-consolidation audit for the internal assistant (all
  SQL-verified against kqdc).** Connectivity clean: 0 orphans across
  unified_sales/roster/checklist/invoice/bank-line joins. unified_sales VIEW is
  the ONLY sales truth (merges pos_native live + storehub ≤6/17 + hubbo ≤1/20 +
  consignment; cutover verified per-outlet exclusive, no double-count).
  Dead/empty tables (never query): SalesTransaction (ends 4/11),
  fin_bank_transactions, fin_invoices, fin_bills. TWO revenue lenses: till-rung
  (unified_sales nett, Jun ~RM284k) vs banked GL income (Card+Cash/QR+Grabfood+
  GastroHub, Jun ~RM406k, settlement-lagged, SST-incl) — Grab delivery revenue
  exists ONLY in the GL/bank lens. NILAI = consignment outlet (no till; sales
  are periodic consignment settlements, latest 6/28; 0 ParLevel rows; its
  "ownerless checklist" alerts are likely SOP misconfig for that model).
  "orders" (lowercase, customer pickup) ≠ "Order" (procurement PO). All other
  domains fresh as of audit day (attendance, stock counts, reviews, loyalty,
  bank feed via Bukku 6h sync — 3 accounts = complete set per owner). Encoded
  in `apps/backoffice/src/lib/ops-intake/data-map.ts` (the assistant's
  intelligence layer) — keep that file updated when semantics change.

- 2026-07-12 — **April-era "Celsius QA" Telegram monitor decommissioned (cron
  side).** It was two systems, both built ~Apr 5–7 against the pre-monorepo app
  layout (standalone inventory/loyalty apps, retired since):
  1. `qa-health-check` edge function on the **celsius-inventory** Supabase
     project (`akkwdrllvcpnkzgmclkk`) + pg_cron jobs `qa-health-check`
     (`7 * * * *`, hourly — matched the 1:07pm alerts) and `qa-health-report`
     (4×/day). This was the source of the "🚨 Celsius QA Alert" Telegram spam
     about `inventory.`/`loyalty.celsiuscoffee.com` DNS failures. **Both cron
     jobs unscheduled 2026-07-12** (cron.job on that project is now empty). The
     function itself is still deployed, publicly invocable (`verify_jwt:false`),
     and has a **hardcoded Telegram bot token in its source** — rotate the bot
     token and delete the function from the dashboard (MCP has no delete).
  2. `qa-health` + `qa-autofix` edge functions on the **main** project
     (`kqdcdhpnyuwrxqhbuyfl`), pg_cron `qa-health-check` every 30 min, check
     list in the `qa_health_checks` table. Its 4 inventory/loyalty rows had
     been failing since April (4,200 consecutive failures; `qa_alerts` grew to
     ~10k rows since Apr 7) and each failure re-triggered `qa-autofix` — which
     can **redeploy retired Vercel projects** (loyalty/inventory/pos project
     IDs are hardcoded in it).

  **Fully cleared 2026-07-12 on owner's go-ahead:** the main project's 30-min
  cron unscheduled; `qa_alerts`/`qa_fix_rules`/`qa_health_checks` dropped
  (migration 080 — note: they were in `prevent_drop_critical_tables()`'s
  hardcoded protected list, which the migration amends to remove ONLY those
  three); all 3 edge functions (`qa-health`, `qa-autofix`, `qa-health-check`)
  overwritten with secret-free 410 tombstones + `verify_jwt` on (MCP cannot
  delete functions — delete from the dashboard at leisure). Nothing monitors
  the live apps now — BetterUptime (ops-hardening checklist §3) is the
  intended replacement. **Human actions remaining:** rotate the Telegram QA
  bot token (old versions of `qa-health-check` embed it in source), delete
  the 3 tombstoned functions, and decide whether the idle `celsius-inventory`
  Supabase project (`akkwdrllvcpnkzgmclkk`) can be paused/deleted entirely.
- 2026-07-10 — **Vercel schedules at most 40 cron jobs per project; entries past
  40 are silently never scheduled.** vercel.json hit 46 (Jun 30) and the tail —
  procurement-exec, par-levels-recalc, request-invoices/receivings,
  consumption-post, labour-variance — was dead ~10 days with zero errors.
  Consolidated to 37 via dispatchers (`cron/procurement-loop`, `cron/ops-nudges`);
  `apps/backoffice/src/vercel-crons.test.ts` fails CI past 38. **Never append a
  41st cron — fold into a dispatcher.**
- 2026-07-10 — Procurement loop has a watchdog (`lib/inventory/loop-watchdog.ts`,
  runs in the procurement-loop cron): stale pars, undelivered cold prompts,
  100%-failing send channels, stale proposals/drafts → owner WhatsApp digest,
  fingerprint-deduped. Agent lessons (agent-lessons.ts) default ON since #895.
- 2026-07-10 — The AP bank matcher is RECONCILE-ONLY on the 6-hourly loop
  (Telegram POP is the primary payer); only the EOM `cron/ap-match-apply` may
  mark open invoices paid (`markOpenPaid:true`). Bank narrations quoting a
  different invoice number veto the match (312/1049 historical matches settled
  the wrong same-amount invoice; ~113 double-count risks still need a manual
  reconciliation pass — unfixed data).
- 2026-07-10 — PDF cold-send path (PROCUREMENT_PO_DOC_TEMPLATE) is hard-disabled
  in code: the Meta template never matched (16/16 sends failed #132000). Cold
  sends ride prompt→reply→block, with 24h re-prompt + give-up note. Re-enable in
  procurement-po-send.ts once the template truly has a DOCUMENT header + {{1}}/{{2}}.

- 2026-07-04 — `apps/pos-native` and `apps/pickup-native` sit **outside** the npm
  workspace (own `package-lock.json` each); root `npm ci` does not install them.
- 2026-07-04 — Two migration directories exist: `packages/db/prisma/migrations/`
  (the audit trail CI's migration-guard checks — files are saved, never executed)
  and `supabase/migrations/` (018–070, applied history). Schema of record is
  `packages/db/prisma/schema.prisma`.
- 2026-07-04 — `.claude/launch.json` is partially stale: `inventory`, `loyalty`,
  and `pos` entries point at `apps/` directories that no longer exist.
- 2026-07-04 — Procurement loop: automated PO-send to suppliers over WhatsApp
  (`purchase_order` / `po_approval` buttons) was designed but **never shipped**;
  sending the order block is still manual. Agent only needs an open PO to exist.
  (Source: `docs/design/procurement-e2e-test-runbook.md`.)
- 2026-07-04 — Stock accuracy is shadow-only (consumption engine off); reorder
  runs off receipts − wastage/transfers, not sales. Going live needs unit
  normalisation + recipe import (`docs/design/procurement-qa-2026-06-26.md`).
- 2026-07-05 — RLS coverage is broader than `docs/rls-strategy.md` claims
  (three later migration sets added deny-all/policied RLS to HR, bank, ads,
  and all `fin_*` tables) — but the **loyalty tables' policies are
  `USING (true)` for all roles, so member PII/points are anon-readable AND
  writable**. Full verified map + ranked fixes:
  `docs/rls-access-map-2026-07-05.md`.
- 2026-07-04 — 14 Vercel crons fail silently into logs (no heartbeat
  monitoring wired yet). `reconcile-pending` (order, every 1 min) is the
  payments-critical one. See `docs/monitoring-setup.md`.
- 2026-07-04 — Exception-inbox corrections update `fin_agent_decisions`
  (`corrected=true, corrected_to=…`) — this is the finance agents' eval/
  retraining dataset. Preserve the write path in any refactor.
- 2026-07-05 — Categorizer runs on `claude-haiku-4-5` with a prompt-cached
  COA block; its vendor context is the last **5** bills, not the 50 the
  spec describes (spec drift, `categorizer.ts` `supplierHistory()`).
- 2026-07-05 — The Anomaly agent from the finance spec is **not built**;
  matching is rules-based (`ap-match.ts`) + an LLM verifier — nothing
  writes `fin_matches`. Only `ap`/`categorization` exceptions have a
  resolver; other exception types noop on resolve.

- 2026-07-11 — **Sales revenue is recognised at PAYMENT, not fulfilment.**
  Pickup/QR `orders` payment is confirmed at the pending→paid/preparing
  transition (markRmOrderPaid / confirm-stripe), so the sales dashboard's old
  `status='completed'`-only filter hid paid orders still being brewed (a paid
  RM 77.30 QR order sat invisible all morning). Canonical set is
  `PICKUP_PAID_STATUSES` in `unified-sales.ts` (paid/preparing/ready/collected/
  completed) — used by dashboard, reports, staff app, labour gate. `pos_orders`
  stays `completed`-only: the till writes completed at ring-up (= paid) and
  Grab settles at collection. Historical days are unaffected — the hourly
  sweep-stale-orders cron forces every paid order terminal within ~3h.
- 2026-07-05 — **Revenue is split across 3 tables** and reconciles to the
  manpower workbook to the ringgit: `storehub_sales` (per-outlet retirement
  Jun 15–17), `pos_orders` (in-house POS from Jun 8/15/18, GrabFood
  included), `orders` (pickup app). Any revenue query must UNION all three
  while the cutover is in a trailing window (`lib/hr/labour-gate.ts`
  `revenueBetween`).
- 2026-07-05 — **PT wages never flow through payroll runs** (Apr+): they are
  weekly bank transfers → `BankStatementLine` (`partimer` rule) → GL
  `6500-03`. June per outlet: Con 5,103 / SA 9,168 / Tam 6,078 / Nilai
  3,892. Outlet venue prefixes exist in descriptions since June; classifier
  fixed + 266 rows backfilled (migration 071).
- 2026-07-05 — All six 2026 monthly payroll runs are status `draft` (no
  OT/allowances finalised) — FT actuals read ~RM3k/outlet flattering vs the
  workbook until closed.
- 2026-07-05 — 4 scheduled staff have no `hr_employee_profiles` row
  (Hidayat, Irfan, a 2nd Haziq — Putrajaya; Fatin — Tamarind). The labour
  gate blocks publishes that include them until profiles+rates exist.
- 2026-07-05 — Shift templates of record are the `hr_shift_templates` DB
  rows (Opening / Middle 1–3 / Closing per outlet); `lib/hr/shift-templates.ts`
  is only the fallback when the table is empty.
- 2026-07-09 — Onboarded **Haziq Bin Nazarrudin** (PT Barista/Kitchen, Shah
  Alam) by MERGING onto his existing access-only login "Haziq PT"
  (`User` `b848feb9-d9d6-4479-9b31-f1b21213550a`, matched on phone
  +601110023104) — did NOT create a new User (would have collided on the
  unique phone and split his schedule/access history). Pattern for HR-only
  records that already have a staff-app access id: `UPDATE "User"` (fullName/
  email/bank) + `INSERT hr_employee_profiles` + starter `hr_salary_history`/
  `hr_job_history` rows, mirroring `/api/hr/employees/create`. PT baristas =
  `part_time` + `hourly_rate` (RM9/hr is the house default; basic_salary 0)
  + `statutory_applicable=false`; Shah Alam PTs run `payroll_cadence=WEEKLY`
  (bank-transfer wages, not payroll runs — see the Apr+ PT-wage fact above).

## General rules

- Typecheck before pushing — every time. CI enforces it, but catch it locally.
- Never test against the production database; the procurement runbook's seed SQL
  is staging-only.
- When a fix is confirmed working, record *why it worked* here or in the relevant
  skill — not just in the chat.

## Open failures

- 2026-07-11 — **`sentry.io` is NOT in the CCR environment's egress
  allowlist** — live Sentry MCP call returned `403 Host not in allowlist:
  sentry.io` — so the nightly Sentry-triage routine (05:00 MYT) has no-oped
  at its guard step every run since 2026-07-04; the weekly email digest was
  the only error visibility. **Human action:** add `sentry.io` (+
  `*.sentry.io`) in the environment's network settings; verify with
  `find_organizations`. Until then the self-fixing loop cannot run. —
  blocking.
- 2026-07-11 — **`JWT_SECRET` is missing from the order app's Vercel env**
  (project `celsius-pickup-app`) — every request logs `[env] order: MISSING
  (required): JWT_SECRET` in BOTH serverless and edge runtimes (verified via
  Vercel runtime logs); this is the 3.6k-event "Ongoing" Sentry issue from
  the weekly report. Not just noise: `@celsius/auth getJwtSecret()` THROWS
  without it, so `POST /api/orders/[orderId]/confirm-maybank-qr` (backoffice
  "Mark paid & release" for Maybank QR) 500s whenever used. Customer/staff
  JWT paths survive on the `CUSTOMER_JWT_SECRET`/`STAFF_JWT_SECRET`
  fallbacks. **Human action (payments-adjacent, hard rule 6):** add
  `JWT_SECRET` to the celsius-pickup-app Vercel project with the SAME value
  as backoffice's, redeploy. — blocking Maybank-QR release.
- 2026-07-11 — **`ANTHROPIC_API_KEY` is missing from the staff app's Vercel
  env** — confirmed live: `GET /api/audits/staff/<id>/coach` 500ed with
  "Could not resolve authentication method" (the 21-event "New" Sentry
  issue); boot check also flags `BACKOFFICE_INTERNAL_URL` (recommended)
  missing. Owner chose to REMOVE the staff AI coach instead of wiring the
  key (done in the sentry-loop PR: coach route + agent + My Skills card
  deleted; unused /api/audits/insights dropped too; staff-native untouched
  — its coach card already hides on fetch failure, remove the dead helpers
  on the next staff-native touch). **Key is STILL needed:** the claims
  receipt-extraction route (`/api/claims/extract`, used by staff web +
  staff-native claims) also runs on ANTHROPIC_API_KEY and is equally
  broken until the var is added to the staff Vercel project.
- 2026-07-05 — **`pos_*` + `orders`: 14 `USING(true)` policies are BY
  DESIGN** (SUNMI tills write via the anon key). Do NOT lint-fix — needs a
  data-layer plan (rls-strategy.md Path A). 4 `security_definer_view` +
  ~12 `function_search_path_mutable` remain as low-risk hardening.
- 2026-07-05 — Most Vercel crons still have no heartbeat monitoring
  (`reconcile-pending` wired 2026-07-05; procurement family covered by the
  loop watchdog since 2026-07-10; HR/finance/ads crons still fail silently).
- 2026-07-05 — Pickup dashboard **inventory tab reads tables that don't
  exist** (`ingredients`, `stock_levels`, `ingredient_outlet_settings` —
  absent from BOTH Supabase projects); it has been silently empty. Either
  wire it to the real procurement stock tables (`StockBalance` etc.) or
  remove the tab.

_Resolved 2026-07-05 evening (see Lessons + access-map correction): the
"loyalty tables anon-writable" finding was already fixed in production —
live DB had drifted ahead of repo migration files. Actual live exposure
was the `outlets` view (anon DML, RLS bypass); revoked same day
(supabase/migrations/073, applied via Supabase MCP, verified). Full
get_advisors sweep then closed ALL remaining anon-reachable tables:
10 backup snapshots (074) + 14 server-only tables incl. PendingPop/grab_*
(075). Verified: rls_disabled_in_public 24→0, sensitive_columns_exposed
2→0, security ERRORs 30→4 (the 4 left are SECURITY DEFINER views)._

_Fixed 2026-07-05 (see Lessons): categorizer correction mis-attribution +
never-set `applied` flag — `related_id` now populated at decision time,
corrections join decisionId → document → supplier, `applied` set on
auto-post and inbox approve._

_Format: `YYYY-MM-DD — <symptom> — <evidence> — <hypothesis/fix> — <blocking?>`_

## Lessons learned

- 2026-07-11 — **Sales pull-to-refresh saga (staff-native), attempt 4:** the
  50e161f "cream pull-well" (absolute View at top:-300 inside the ScrollView)
  made it worse — ScrollView content layers ABOVE the native RefreshControl,
  so the well *covered* the spinner and showed as a bare cream slab under the
  period tabs while refreshing (owner screenshot). iOS 26's spinner ignores
  `tintColor`, so on the dark espresso Sales screen the native spinner cannot
  be made visible at all; do not retry tint/backdrop tricks. Fix: rely on the
  screen's own gold "Updating…" header row during `refreshing` too, cream tint
  kept only for platforms that honour it (older iOS, Android's cream card).
  Round 2 (owner, same day): holding `refreshing={true}` on the control kept
  iOS's tall overscroll inset open for the whole fetch — a big empty gap that
  "looks like lag" — and the spinner+"Updating…" text row read off-centre.
  Final shape: RefreshControl is TRIGGER-ONLY (`refreshing={false}` constantly;
  RN force-syncs native state after onRefresh so the control retracts on
  release, no stuck spinner) + a bare centered 20pt gold ActivityIndicator row
  under the tabs as the sole in-flight indicator, matching the checklist
  spinner size.

- 2026-07-04 — `eas update` shells out to `expo export`, whose interactive
  prompts ignore `--non-interactive`; set `CI=1` in the environment instead.
  Pass commit messages via env var, not inline in the shell command (backticks/

- 2026-07-05 — The AI Fill week-wipe (60 shifts) was the old generator's
  DELETE-then-INSERT persist with no transaction; `hr_schedule_shift_audit`
  (migration 070) held every deleted row and `jsonb_populate_record` restored
  them losslessly. Replace-style writers must delete+insert in ONE
  transaction, and the delete-audit pattern pays for itself.

## Resume pointer

- 2026-07-11 — **Backoffice nav housekeeping (round 4)** — nav registry gains
  `hidden` items (in ⌘K/route-gate/grants, out of the sidebar; see
  `lib/nav.tsx` NavItem doc). Evidence-based prune (every hide verified
  reachable via in-page link or HR tab strip, or is audit/config-grade):
  HR 17→7 sidebar entries (one per module — strips reach siblings, verified
  unfiltered by moduleAccess), Ops Dashboard hidden (same API as Performance,
  which is the superset + new section landing), SOP Categories moved to
  Settings→System, Recipe Cards/Points Log/Outcome Types/Settings Hub hidden.
  Finance "Legacy" group renamed **Cash** — cashflow + cash-tracking are the
  actively-maintained cash-basis lens, NOT deprecated (verified in code; do
  not prune them). Kept after verification (distinct tools, sidebar-only
  reach): Compare, Cashier Performance, Inventory Reconciliation, Rank
  Scoreboard, Ads Optimizer.

- 2026-07-11 — **Sentry self-fixing loop** (branch
  `claude/sentry-self-fixing-loop-5tdrxm`): `sentry-triage` skill upgraded
  from one-way triage to a closed loop — per-issue draft-PR fixes (branch
  convention `claude/sentry-fix-<shortid>`, ≤3/run), next-run verification
  of merged fixes against live Sentry (quiet → resolve issue w/ PR link;
  still erroring → one `-r2` retry; then escalate here), state reconstructed
  from GitHub PR search + Sentry status (no repo ledger). Design:
  `docs/design/sentry-self-fix-loop.md`. The existing nightly routine
  (`trig_01NZbJV3A36TeXRKpBkFjxWx`, 05:00 MYT) picks the new procedure up
  automatically once merged — its prompt defers to the skill file. **Blocked
  on the sentry.io egress allowlist fix (see Open failures)**; after the
  owner fixes that, note: 2 of the week's top 3 issues were already
  root-caused WITHOUT Sentry via Vercel runtime logs (see the two
  2026-07-11 Open failures — both are missing Vercel env vars, human
  actions). Remaining for the first live run: `TypeError: Cannot read
  property 'toFixed' of undefined` (5 events, New — needs the Sentry stack
  trace to localise), then verify the two env fixes landed (issues go
  quiet → resolve them in Sentry per the skill).

- 2026-07-10 — **Backoffice nav UX rework** (PR #894, merged on owner's
  approval after a clickable preview artifact). Owner said the tabs were
  "haywire". Nav config extracted from `(admin)/layout.tsx` into
  `src/lib/nav.tsx` (single registry shared by sidebar + ⌘K palette + route
  gate). Behavior: section headers open AND jump to the section's first page
  (expand-only shipped briefly in #894; owner reverted it next day — clicking
  a tab must navigate; keep it), clicking the open active section collapses
  it, section highlight stays on while open, mobile sheet closes on page
  pick. Structure: rail reordered into clusters (Sales/Procurement/Ops ·
  HR/Finance · Rewards/Marketing · Catalog/Settings, with rail dividers —
  `dividerBefore` was previously dead config, now rendered); duplicate
  Packaging entry removed (single home: Catalog); GrabFood folded into
  Marketing → Advertising; ordering labels were briefly swapped to
  "Supplier Chats"/"Purchase Orders" but the owner reverted them next day —
  the team's vocabulary is **"Purchase Orders" = supplier-chats page,
  "PO List" = /inventory/orders**; keep it;
  single-item subgroups merged (HR Leave→Time & Leave, Rewards Manual
  Grant→Channels, Settings People→Business, Procurement Analytics→Overview);
  HR icon Bot→Users. ⌘K palette now searches nav pages (RBAC-filtered) above
  employees. **No URL or moduleKey changes** — perms dev-guard still covers
  every grantable key. All verified: tsc, eslint (3 pre-existing warn-level),
  347 vitest, next build. Round 2 (owner: "sub tabs need arranging too"):
  Sales/Ops/Finance flat lists → subgroups (Overview/Daily/Reports,
  Overview/Daily/Setup, Books/Reference/Legacy), Catalog reordered
  products→BOM→cards→packaging→posters. NOTE: GitHub Actions dropped the
  `synchronize` CI runs for the round-2 pushes (only the first commit got a
  PR run); verified locally (tsc/eslint/vitest) and via the on-merge main
  CI run instead.

- 2026-07-10 — **Procurement loop QA round 2 + "fix all"** (PRs #883 #885 #891
  #895 merged; earlier same-arc: #714 par ABC value-cap, #806 cold-send fixes,
  #835/#836 invoice-capture approve flow). Root findings: the cron cap (see
  facts), invoice/receiving tail leaks (revisions dropped, PARTIALLY_RECEIVED
  chase black hole, Cancel deleting the GRNI payable, chaser suppressed by
  placeholders, EOM matcher paying DRAFTs) — all fixed; ASSIST fidelity (wrong-PO
  target, multi-item proposals lossy, ETAs dropped, untruthful resend, double
  replies) — all fixed. Pars recalced in prod for all 3 POS outlets via SQL
  mirroring par-calc.ts (fresh 2026-07-10, ABC classes; weekly cron takes over
  Sundays). **Still open:** webhook runs 3 sequential LLM calls before Meta's
  200 (throttling risk — needs its own PR); ~113 historical wrong-invoice bank
  matches need a finance-approved re-pointing pass; invoice_request template
  still needs one OWNER visit to /api/ops/workspace/templates?action=create to
  submit to Meta.

- 2026-07-06 — **Checklist auto-assign: data-driven FOH/BOH station** (PR #824,
  branch `claude/auto-assign-checklist-hqqzfd`, draft — NOT yet merged). Root
  cause of "auto-assign didn't assign the attended person": station came from a
  hardcoded title map in `ops-nudges` that mis-classed *Ice Machine Cleaning* as
  kitchen (it's at the bar → FOH). Now data-driven both sides: `Sop.stations`
  (enum `SopStation{foh,boh,lead,shared}`, **array/multi-select** — a SOP can be
  FOH+BOH or shared) + `hr_employee_profiles.station` (text, nullable = infer
  from position). Auto-assign pools anyone matching ANY of the SOP's areas
  (`matchesAnyStation`); explicit employee station overrides position;
  `STATION_POSITIONS` foh←barista/cashier, boh←kitchen. UI: multi-select on SOP
  create+detail pages; FOH/BOH/lead selector on the employee Employment card.
  **Both migrations APPLIED to prod + verified 2026-07-06** (`sop_station`,
  `hr_profile_station`); today's 3 ice-machine rows repointed to FOH baristas.
  **Still open:** merge+deploy PR #824 so the new routing runs (until then the
  OLD armed cron/JIT still uses the kitchen map — the old JIT could re-own
  tonight's ice machine to kitchen only if the FOH assignee never clocks in).

- 2026-07-05 — **Staff access-control audit + hotfixes** (`docs/staff-access-
  audit-2026-07-05.md`). Application-layer RBAC audit across POS login, staff
  app, checklists, stock count, receiving, own audit/performance, backoffice,
  and the cross-app identity layer. Root cause: enforcement copy-pasted inline
  into ~470 routes, 3 divergent `getSession`/`requireRole` impls, client-only
  module/UI gates. Much was fixed in parallel: #697 (order `/api/staff/*` +
  staff dashboard/products/settings auth), #802 (anon RLS surface 24→0), #799
  (vitest `@/` alias). This session added: **decommission** of the retired
  order `/staff/*` web surface + dead feed routes (kept `staff-token.ts` +
  `/api/orders/[orderId]/status`, load-bearing for pickup-native collect), and
  **staff hotfixes** (audit `[id]` read/write scoping, `transfers/[id]`
  outlet check, `switch-outlet` outletIds, dashboard outlet-pin). **Still
  open:** C-2 (POS `verify-manager` PIN oracle, OTA-coupled), H-1 (backoffice
  `ops/audit-*` reachable by STAFF cross-app token — wrong `getSession`
  import), H-4 (MANAGER over-reach across ~150 `requireAuth`-only backoffice
  routes), H-5 (session revocation unwired), M-1 (`CUSTOMER_JWT_SECRET`
  fallback). Durable fix = the `withAuth({roles,module,scope})` guard + CI
  check in §5 of the doc (not yet built).

- 2026-07-05 — **Ads + local-rank loop hardened** (PRs #732/#751/#781/#783/#797
  all merged): budget-cut optimizer live at `/ads/optimizer` (waste tier +
  efficiency trims vs fleet-best cost/conv, `ads_budget_change` ledger applied
  to prod, approval-gated, weekly shadow inside `ads-daily` Mondays); keyword
  strategy board at `/reviews/geogrid/keywords` (own/focus/prominence/retire,
  opportunity-sorted). **Measurement bugs fixed:** `ads_campaign.status` stores
  Google's numeric enum ("2"=ENABLED) — filter with `ENABLED_STATUSES`; the
  geogrid auto-scan defaulted to 0.2mi (storefront) — now 1.5534mi = the ±10km
  catchment; keyword buckets only trust complete catchment-scale scans (Nilai's
  "owned" verdicts were 0.1mi artifacts). **Tamarind was wired to Shah Alam's
  GBP location** (poisoned snapshots Jul 3–5, deleted from prod; the fake
  160.6/day velocity was the count-jump): `reviews-daily-snapshot` now
  self-heals `gbpLocationName` nightly by matching `gbpPlaceId` (set for all 4
  outlets from verified scan/QR evidence) against `listAccountLocations`;
  on-demand check at `/api/reviews/gbp-relink[?apply=1]`. **Lever validation:**
  categories = strongest rank lever; review velocity ≈20% and the binding
  constraint (Nilai 2/30d, SA ~11, Tam ~17, Putrajaya 34); GBP description is
  NOT a rank factor — stop treating geo-in-description as a rank play.
  **Next:** after the first true-10km scan (Mon Jul 6, 1pm MYT) read fresh
  baselines and propose per-outlet GBP category adds; owner still owes the ads
  search-term backfill curl (CRON_SECRET) and the review-velocity ops push.

- 2026-07-05 — **People-cost gating loop shipped** (PRs #765/#780/#785 all
  merged): labour gate + publish enforcement (green/amber/red, per-outlet
  budgets Con 16/18, SA 18/20, Tam 22/25 interim), editor badge + per-day
  coverage chips, PT bank-line outlet tagging, Monday variance digest
  (`cron/labour-variance`, SHADOW — flip `LABOUR_VARIANCE_MODE=armed` after
  one sane Monday), and a rule-based+agentic AI Fill (DB templates, FT 45h +
  rest days, rovers 2 days/outlet, PT as amber `pt_suggestion` cells inside
  the budget envelope). Design + verification:
  `docs/design/people-cost-gating-loop.md`. Humans owe: profiles for the 4
  orphan staff, finalise 6 draft payroll runs, confirm Tamarind 22/25.

- 2026-07-04 — Harness scaffolding rounds 1+2 done: root `CLAUDE.md`, this
  file, skills `{db-migration,ota-release,procurement-e2e,finance-module,
  sentry-triage}`, workflow `.claude/workflows/rls-audit.js`, and a nightly
  Sentry-triage routine scheduled (05:00 MYT, fresh session per run —
  manage via the Routines/triggers list).
  Next candidates: run the `rls-audit` workflow and act on the report;
  build the finance eval replay (corrected `fin_agent_decisions` rows →
  regression set per agent, see finance-module skill); wire cron heartbeat
  monitors (`docs/monitoring-setup.md` §2).
- 2026-07-05 — Hardening batch shipped: pickup-page reads moved server-side,
  `related_id`/`applied` fixes, `reconcile-pending` Sentry heartbeat,
  `docs/ops-hardening-checklist.md` (human dashboard items + quarterly
  key-rotation calendar reminder on barista@, next 2026-10-01), and the
  loyalty policy-fix proposal in `docs/proposals/`. **Waiting on human:**
  apply the proposal SQL after deploy (checklist §5), `hr_payroll_runs`
  RLS one-liner (§6), IP allowlist (§1), BetterUptime + Vercel→Slack (§3),
  PITR decision (§4). SMS attribution holdout (loop #1) still needs the
  two owner decisions: exact reward + success bar
  (`docs/design/sms-loop-engineering.md`).
