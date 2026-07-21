# STATE — cross-session memory

Working memory for agent sessions on this repo. Read this at the start of every
session; update it before ending one. Keep entries dated, terse, and factual —
delete entries that have been promoted into `CLAUDE.md`, a skill, or a doc.

## Verified facts

- 2026-07-22 — **First-order 10% discount made native-app-only** (branch
  `claude/first-order-discount-check-lx938r`, draft PR). Business intent: the
  welcome 10% is now a native-app perk (drives installs) on BOTH pickup and
  dine-in; the web/PWA gets nothing. FOD config still lives on the
  `promotions` row `promo-first-order-celsius` (trigger_type=first_order,
  percentage_off 10, is_active). Data finding that drove this: over 30d, FOD
  landed on 0/2,511 dine-in orders (any source) but ~30% of pickup — because
  the row was `channels=['pickup']` and dine-in runs the `qr_table` channel;
  the split was order-type, NOT native-vs-PWA. **New mechanism:** gate on
  order `source`, not channel. `/api/orders` (native, source app_ios/
  app_android — pickup + dine-in) applies FOD; `/api/checkout/initiate`
  (PWA, QR-table dine-in, source web_qr) and `/api/checkout/quote` (PWA
  preview) no longer apply/preview it. The `promotions.channels` field is now
  vestigial for FOD (code gates on source); left at `['pickup']`. Native
  checkout still only shows FOD at the receipt (its preview uses
  `/api/loyalty/promotions/evaluate`, which excludes first_order) — unchanged,
  possible follow-up. **Live-behaviour note:** the discount only lands at
  order create, so it needs the PR deployed; until then prod behaviour is
  unchanged (native pickup only).

- 2026-07-16 — **Finance warehouse baseline (SQL-verified against kqdc).**
  Fresh: unified_sales pos_native →7/16, consignment →7/12 (Nilai settles
  later than older notes claim — re-verify live, don't trust dated notes);
  BankStatement 3 accounts →7/15; BankStatementLine 56,429 rows, 0
  uncategorised (rule 55,119 / ap-match 1,134 / user 169 / manual 7); GL
  4,621 posted txns / 10,446 lines / COA 116 active; June payroll actuals
  booked RM77,259.50; unpaid AP 72 PENDING RM45,060 + 16 INITIATED RM7,780
  + 9 DEPOSIT_PAID RM20,988. **Findings:** `fin_agent_decisions` has only
  7 rows, ALL agent='purchasing-manager' — the finance agents' documented
  decision-log/eval dataset is NOT accumulating (logDecision not on live
  paths or failing silently); ALL 19 fin_periods 2025-01→2026-07 are open
  (no close ever approved); 88 draft fin_transactions linger (latest 6/30);
  37 future-dated posted rows are month-end depreciation (legit convention,
  but descriptions contaminated with bank narrations); July MTD lens gap:
  till RM133,241.75 vs GL income RM163,976.74. Full inventory + backlog:
  `docs/design/finance-data-warehouse-agent.md`.

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
- 2026-07-14 — **Multi-outlet staff rotation (code-verified).** Membership is
  `User.outletId` (primary) + `User.outletIds[]` (additional) — editable ONLY
  in Settings → Staff (outlet checkboxes; the HR employee page edits primary
  only). Every scheduling surface pools `outletId OR outletIds has`: grid,
  AI Fill, assist candidates. Assist candidates (`schedules/candidates`)
  count weekly hours ACROSS outlets (query is user-scoped, not
  outlet-scoped) and flag `double_booked`/`over_cap` cross-outlet; they also
  score a `home` signal (primary 1 / outletIds 0.8 / other 0.5). Clock-in
  (`staff /api/hr/clock`) picks the nearest assigned outlet by GPS, so
  attendance logs the outlet actually visited. Leadership rotation = the
  rover path (Manager/Area Manager/Barista Lead, 2 days/outlet, HQ-costed,
  cross-outlet busy check). **Gap:** AI Fill's cross-outlet busy check
  covers rovers ONLY — a regular FT/PT in two outlet pools is generated
  independently at each (FT: 6 days at BOTH; PT: 24h/5d caps applied per
  outlet run → up to 48h), and the manual `cell`/`assign` writes have no
  hard cross-outlet overlap guard (the warning is advisory in the ranking
  UI only). Fix shape: extend the rover `busy` set to all pooled staff in
  the generator, seed `ptWeek` from other-outlet shifts, add an overlap 409
  in cell/assign.
- 2026-07-14 — **Multi-outlet double-booking fixed** (branch
  `claude/staff-rotation-outlets-kmobpa`, PR #934). Owner rule chosen:
  **primary outlet wins**. AI Fill (`schedule-generator.ts`) now: (1) loads
  every pooled staffer's shifts at OTHER outlets for the week
  (`bookedElsewhere`) and never places anyone on a day they're already
  working elsewhere; (2) floors a full-timer's 6-day week ONLY at their
  primary outlet (`isPrimaryHere = User.outletId === outletId`) — a shared FT
  is listed in `ai_notes` as "rostered at their primary, not here" and must be
  borrowed manually at secondary outlets; (3) seeds each PT's `ptWeek`
  hours/days from other-outlet shifts so the 24h/5-day caps bind on the
  COMBINED total. Manual writes: `cell` + `assign` routes call
  `findCrossOutletOverlap` (new `lib/hr/cross-outlet.ts`) and 409 on a
  same-day cross-outlet time overlap. **Residual (best-effort, documented):**
  generation is per-outlet on-demand, so "primary wins" for a same-day PT
  conflict relies on generating home outlets first — no destructive
  cross-outlet steal. The assist-candidate ranking was already
  cross-outlet-aware (user-scoped hours, `double_booked`/`over_cap`).

- 2026-07-18 — **Sales Compare robustness pass (branch
  `claude/sales-compare-robustness-q5peil`).** Four verified gaps in the
  backoffice unified-sales path (`api/sales/_lib/unified-sales.ts`), all
  fixed there so every consumer (compare, dashboard, P&L-sourced, recon)
  inherits: (1) 741 StoreHub rows with `status='paymentCancelled'` but
  `is_cancelled=false` (RM24,398.90, Aug 2025–Jun 2026) were counted as
  revenue — the raw path lacked the canonical convention's status filter;
  (2) `hubbo_sales` (70,395 rows, the pre-StoreHub till for
  Putrajaya/Shah Alam through Jan 2026) was missing entirely — any
  comparison reaching before the outlet's StoreHub start read near-zero;
  raw path now mirrors the view's exclusive handover split (hubbo <
  handover instant ≤ storehub); (3) consignment-only outlets (Nilai, IOI
  Mall — `storehubId` NULL) were excluded by compare's outlet filter, so
  "All Outlets" silently omitted them; (4) `computeProjection` still read
  DEAD SalesTransaction → server projection was always null (client 7d-MA
  fallback masked it); re-pointed to the unified_sales view with the
  canonical revenue convention. Also: sales-channel dimension
  (till/qr_table/pickup_app/grabfood/beep/delivery_other/consignment,
  `_lib/source-channels.ts`) now flows through compare (`sources` per
  period + UI breakdown table), consignment daily rows carry
  units=item_count into orders/AOV, and partial-vs-full comparisons show
  an aligned "first K days" pace line in the summary cards. MERGED as
  #976. Round 2 (owner: "cannot pick multiple outlets"): outlet filter is
  now multi-select — API takes `outletIds=a,b,c` (legacy `outletId` kept
  for the staff bridge), UI is a checkbox popover; selecting every outlet
  collapses to the all-outlets default. MERGED as #992. Round 3 (owner:
  "check all the ux ui, improve it"), page-only pass: presets are visible
  chips (active highlighted); page auto-opens on This Month vs Last Month;
  state persists in the URL (?p=&o=&m= — shareable links); refetches dim
  the old results instead of blanking (full spinner only on first load);
  fixed a REAL Tailwind bug (template-string `sm:grid-cols-${n}` is never
  JIT-generated — summary cards always fell back to 2 cols; now a static
  class map); Rounds table gains an "Other hours (11pm-8am)" row so Total
  reconciles with its rows; Order Type table flipped to rows=type ×
  cols=periods (consistent with all other tables) + share %; Month tab in
  the Add Period picker (last 12 months); chart gains a dashed "now"
  reference line + whole-K y-ticks ≥100k; summary deltas labelled
  "vs {period}"; outlet-context caption beside the metric toggle. Round 3b
  (owner screenshots): **REAL BUG — outlet-filtered compare showed stale
  cross-outlet data.** Cent-exact forensics: "Tamarind" card = Tam+SA,
  "Shah Alam" card = ALL outlets — overlapping fetches with no guard; an
  older bigger response landing last overwrote the newer one. Fixed with a
  fetch sequence guard + AbortController. Also: "Other Delivery" (owner:
  "should be grab") is actually the retired StoreHub Beep channel (May-era
  volume ≈ Grab's; Grab has its own row) — relabelled "Beep / Other
  Delivery". NEW: Payment Method dimension in compare (per-period gateway
  table, Δ + share of tendered total + coverage row; pos dominant-tender +
  pickup payment_method; validated cent-exact vs the By Payment report for
  Jul 11-13; StoreHub era has no payment splits — caveat shown).
  Round 3c (owner: "add QR Table to By Channel tab"): Sales Reports → By
  Channel rebuilt from order-type (dine-in/takeaway/grab) to the SALES
  CHANNEL source axis (Till/QR Table/Pickup App/GrabFood/Beep/Consignment,
  each order once) — QR Table was previously invisible, folded into
  dine-in/takeaway. reports.ts buildByChannel now aggregates ev.source via
  SOURCE_ORDER/SOURCE_LABELS; note points to Sales over time for the
  dine-in/takeaway split (which keeps its order-type columns). Verified
  Jul 11-13 all-outlets: Till 21,208.52 / QR 8,049.80 / Grab 3,314.20 /
  Pickup 602.30 = 33,174.82, cent-exact vs By Payment total. Frontend is
  fully generic (columns/rows/note) — no page change needed.

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

_Format: `YYYY-MM-DD — <symptom> — <evidence> — <hypothesis/fix> — <blocking?>`_

- 2026-07-20 — **Filters + reports QA sweep (branch
  `claude/sales-compare-robustness-q5peil`, PR #1021).** Owner reported the
  stale-response filter race on Sales Compare then Cashier Performance ("not
  updated when filter"); audited ALL 92 filtered backoffice pages (5 parallel
  agents). **SWR pages (`useFetch`) are race-safe by construction; only
  imperative fetch+useEffect pages have the bug.** New shared hook
  `lib/use-latest-request.ts` (seq counter + AbortController) applied to the 8
  unguarded pages: sales/dashboard, AccumulativeChart, pos/reports,
  reviews/geogrid (loadHistory), pickup/analytics (orders — `cancelled` flag),
  loyalty/members (pagination — plain seq ref, helper takes no signal),
  loyalty/loops, loyalty/dashboard. **Speed done:** per-row `pay_method`
  correlated subquery (added in the payment work; on dashboard+compare every
  request) → one batched `DISTINCT ON` (254/254 cent-exact vs subquery);
  cashier phone-chunk member lookups → `Promise.all`. **Deferred/proposed
  (change numbers or need care — NOT done):** z-report aggregates by
  outlet+time-window not shift_id → two registers cross-contaminate
  gross/net/tax (money bug) + its per-shift N+1; MYT date off-by-ones
  (ops/performance, inventory purchase-summary + wastage, ads/grab,
  reviews/dashboard, pickup/analytics — bucket to UTC not MYT, "to=today" can
  show nothing); loyalty/members full-table item scan every mount;
  supplier-scorecard 3×N fan-out; cogs full-scan→groupBy; optimizer unbounded
  findMany→distinct; main dashboard triple per-outlet fan-out; cashflow
  sequential awaits + triple BankStatementLine scan. loyalty/dashboard/kpi
  route looks orphaned (no client consumer) — verify before optimizing.

## Lessons learned

- 2026-07-14 — **Every upload control must accept drag & drop** (owner
  directive: "this should be the standard"). Backoffice audit found the
  standard mostly hand-rolled per page and four click-only gaps (invoice Edit
  photos, Mark Paid receipt, recon attachments, Maybank QR) — all fixed. For
  NEW upload UI use `components/ui/file-dropzone.tsx` (shared, drag-aware,
  accept-filtered) instead of another bespoke label+hidden-input.

- 2026-07-14 — **Always check the date format** (owner directive). Malaysian
  supplier documents are DAY-FIRST (06/07/2026 = 6 July); the doc extractor
  stamped due date 14/06/2026 on two KLFC invoices *issued* 06/07/2026, which
  flipped an unpaid invoice to OVERDUE off a date that predated its own issue.
  Whenever reading or writing dates (invoices, bank narrations, screenshots,
  SQL), confirm DD/MM vs MM/DD from context and sanity-check orderings
  (due ≥ issue, paid ≥ issue). Systemic guard now in
  `finance/parsers/supplier-doc.ts` (`sanitizeBillDates` + day-first prompt
  rule); both KLFC due dates corrected in prod (7-day terms → 2026-07-13).

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

- 2026-07-05 — The AI Fill week-wipe (60 shifts) was the old generator's
  DELETE-then-INSERT persist with no transaction; `hr_schedule_shift_audit`
  (migration 070) held every deleted row and `jsonb_populate_record` restored
  them losslessly. Replace-style writers must delete+insert in ONE
  transaction, and the delete-audit pattern pays for itself.

## Resume pointer

- 2026-07-22 — **POP matcher: separator-tolerant invoice-reference matching
  (PR #1024).** Owner asked why a RM148 Blancoz payment was in the Confirm-POP
  queue when the receipt named its invoice. Root cause: the receipt quoted
  `26 0677` (space, off the bank app) for our `26-0677` (hyphen); step-1's
  exact-equality match and step-8's raw-`contains` guard both missed on the
  separator, so it fell to the blind picker against unrelated same-amount
  siblings (26-0713/0714/0746). Fix: `normalizeInvoiceRef` folds both sides to
  an alphanumeric key before comparing — step 1 gains a normalised fallback
  over the open-invoice pool (supplier-scoped, exact normalised equality so
  `260677`≠`1260677`); step 8's named-invoice lookup prefilters on the longest
  digit run then compares folded keys. Also cleaned the stuck record: attached
  ref `936475062M` to the already-PAID 26-0677 + RESOLVED the stale PendingPop
  (d306da79) → the three phantom badges cleared. Owner insight worth acting on:
  finance IS quoting invoice numbers on transfers — the more consistently that
  ref lands in the payment detail, the fewer POPs reach the picker at all.

- 2026-07-22 — **Cashflow page adopts the 13-week model + outgoing payables
  panel (branch `claude/cashflow-13week-payables-kozj9o`, draft PR #1037).**
  Owner: "best is to do the 13 weeks cashflow model… incoming settlement is
  very good, need to add incoming payables… easy to filter incl. custom date."
  Shipped: (1) forward horizon defaults to 13w (4/8/13/26) and the weekly
  projection table is TRANSPOSED into the classic treasury layout (line items
  as rows, weeks as columns, Receipts/Disbursements/Net/Closing, lowest week
  tinted) — same computeCashflow engine, no math change; (2) NEW
  `lib/finance/payables-forecast.ts` + `/api/finance/cashflow/payables` +
  `PayablesPanel` mirroring IncomingPanel: unpaid invoices on due dates
  (remaining honours amountPaid/deposit, same rules as the weekly
  projection), active RecurringExpense occurrences on theirs, standing
  Overdue block relative to TODAY (past-due + undated invoices — can't hide
  behind the date filter), day rows expand to payee lists, category chips;
  (3) incoming + payables APIs/panels both take custom from/to (shared
  DateRangePicker) alongside 7/14/28d presets, capped 92 days. Unit tests for
  the pure payables fns; 491 tests green. NOTE: recurring occurrences use
  month-add date walking (same day-31 drift as cashflow.ts addMonths —
  consistent, not fixed). Next: owner feedback on the transposed grid, and
  whether payables should also feed a per-outlet filter.

- 2026-07-21 (procurement round) — **PR #990 merged (`c268332`) + staff-native
  OTA published (run 54, green 03:07 UTC).** Ships: GRNI placeholder namespace
  (`GRNI-<outletCode>-<n>`), supplier-scoped POP number matching + placeholder
  corroboration, capture NUMBER_FORMAT_MISMATCH guard, and the
  balance-receiving fix (staff web + staff-native prefill the REMAINING qty on
  partially-received POs — was double-counting stock on the second receiving).
  Managers get the receiving fix on next app launch. **Awaiting owner sign-off
  (payment records):** TMM CC001 RM509.76 re-number pending TMM SOA + detach
  MnM photo; void/merge MnM "1-15150" duplicate of IVCT-00012005; untangle the
  1-15441 duplicate rows (Nilai INITIATED vs CC003); resolve RM894 NYC picker
  (stale ref "1216") and RM924 verifier proposal → INV-2682. **Waiting on bank
  feed:** the 5 Jul-20 unmatched payments (Dankoff IN600161377 909.15, TMM
  1-15441 679.68, 365IN2607-0019/0020 490 each, XORA SO-31844 590) — re-match
  when debits land; 3 INITIATED with no debit yet (YSIV2606-1644 932.20,
  F26071056 181, INV-2026-0717-001 120) — owner to check bank app. NYC 1220
  RM606 overdue, unpaid. **Known bugs, unfixed:** Telegram POP conversations
  not persisted (0 `tg:` rows in WhatsAppMessage — no audit trail) and the
  MULTI_POP splitter can silently under-extract pages from a batch PDF (root
  cause of the 5 stuck INITIATED from Jul 20) — good next PR.

- 2026-07-20 (round 16) — **Slot-sizing saga: open slots now follow the FULL
  scheduling logic (PRs #1016 + #1017, both merged; #1015 merged + OTA'd
  earlier).** Owner pushed three times and was right each time. (1) "why 5-6
  slots/day?" → the poster was publishing the optimizer's candidate MENU
  (one gap per template touching a short hour — same 13:00 hole appeared in
  4 overlapping templates); #1016 posts the smallest template set clearing
  the residual per-hour shortfall. (2) "we already have 495 hours, you
  schedule wrong" → hour-level audit proved it half-true: Tue had 3 bar
  openers vs 2 closers with the third body needed in the evening — the
  generator posted a slot for a hole its own FT split created. #1017 adds an
  FT OPEN/CLOSE REBALANCE pass (donors keep need+2-head anchors, Fridays
  skipped for prayer steering, no clopenings) BEFORE any slot is considered.
  The kitchen slots were structural: 5 kit-capable FT × 6d = 30 shifts,
  anchors alone eat 28, demand wants ~34 — a bench gap, not placement.
  (3) "12 slots will shoot up the people cost" → slots are now FUNDED from
  the same RM envelope as the old PT fill (forecast × target% − FT cost),
  ranked kitchen→anchors→deepest days, priced day-aware (9/10/2×PH,
  cheapest eligible PT); unfunded gaps become ⚠ UNMANNED notes + an ai_note
  naming the cost of covering them. Final slot pipeline: demand → FT base →
  rebalance → residual gaps → day cap (ptTargetByDate) → envelope funding.
  PJ 2026-07-27 is a revenue-constrained week (FT floor 20.7% > 18% target,
  envelope RM0) → regeneration posts ZERO slots there by design; owner's
  levers: lend FT, accept higher %, or manual Post slot (stays uncapped as
  the deliberate override). Also this round: employment-window guards
  everywhere (join_date/end_date — generator onLeave rail, grid rows, cell
  route, Assist pool, request+assign; live cases Afique last day 07-31
  mid-week, Auni starts 07-27), open-slots panel collapses to a one-line
  summary ("cannot see schedule" fix), Why-staffing popover edge-alignment
  fix (#1013). Serve-rate calibration flag for owner: model says Sat 9am
  needs 5 cooks (25 items/h ÷ 5.1) — if reality disagrees, recalibrate the
  kitchen serve target, not the slot logic.

- 2026-07-19 (round 15) — **Open slots become REQUEST → ASSIGN, and AI Fill
  goes open-slots-first (owner: "can ai fill open the slots first before we
  assign anyone?" → "lets do they request, we assign" → "after filled,
  manager publish").** The loop is now: AI Fill posts every PT demand gap as
  a bookable slot (new default `ptMode: "open_slots"`; "PT: suggest" option
  in the Fill dropdown restores named pt_suggestion proposals) → PTs REQUEST
  slots in the staff apps (hand-raise, several can; withdraw supported;
  "N asked" count shown) → manager ASSIGNS one requester from the schedules
  grid panel (requester rows show name + week h/d load; assign re-validates
  station/caps/one-outlet-per-day server-side, materializes the shift on the
  DRAFT week, declines the rest) → labour-gated Publish as usual. NEW TABLE
  `hr_open_shift_requests` (migration 091, applied to prod, additive; unique
  open_shift_id+user_id, statuses pending/assigned/declined/withdrawn).
  Staff API POST now creates a request (no more instant claim from apps —
  WhatsApp TAKE keeps instant claim for urgent decline/no-show backfill).
  Unmanned-station QA now splits "⏳ open slot posted, pending booking" from
  the hard "⚠ UNMANNED". Round-14 QA also verified live: 4 manual slots
  posted at PJ by the team via the new UI; claim/assign semantics dry-run
  against prod in a rolled-back txn; NOTE none of PJ's 3 PTs could take
  those barista slots (Nurfarah 23h near-cap, Farhan Ikhmal 29h/6d OVER
  caps in the published roster, Badri kitchen-only) — flagged to owner.
  Weekly-availability table still empty (owner screenshot showed unsaved
  editor) — confirm one real "Save pattern" post-deploy.

- 2026-07-19 (round 14) — **Availability UX overhaul + backoffice open-slot
  management (PR #1011, merged; round-13 base was PR #1010, merged — both
  OTA'd to staff phones and live on Vercel).** Owner: "improve the ux on my
  availability... easier to type numbers, font bigger" and "open slots in
  backoffice logic is not managed yet." Availability screens (web+native):
  typing eliminated — preset window chips (Morning 07:30–15:30 / Midday
  12:00–20:00 / Evening 15:30–23:30) + 30-min pickers (chip strip native,
  dropdowns web, end-times auto-restricted), one-tap Any day/Weekdays/
  Weekends, ≥44px targets, fonts ~2 sizes up, live plain-words summary.
  Backoffice: new /api/hr/open-shifts (GET week's slots + claimant names /
  cancel-if-still-open / create manual slot source 'manual'; hr:schedules
  gated, manager outlet-scoped) + schedules-grid panel (open slots
  cancellable ✕, booked green with names, "+ Open slot" day×template×station
  form). REMAINING E2E LEG (owner action): a PT saves a pattern → regenerate
  a draft week (Jul 27 untouched) → ai_notes show "N PT with declared
  availability" + "N OPEN SLOT(S) posted" → PT books from phone → shift on
  grid. Fastest smoke test: post one manual slot from the grid and have a PT
  book it. Availability table still empty — nothing changes until PTs
  declare; owner should blast PTs to fill it (expect: Aiman weekends-only,
  Batrisyia evenings; ask SA manager about Danish's 2-day week).

- 2026-07-19 (round 13) — **Staff availability input + open-slot booking =
  the self-service PT fill loop (this branch).** Owner: "1. create an
  availability input in staff apps (native/webapp) 2. create a fill / book
  slot in staff apps 3. verify the flow to fill pt." Discovery first: the
  substrate mostly existed — `hr_open_shifts` (migration 084) with a proven
  WhatsApp claim flow (pt-loop inbound `handleClaim`, first-accept-wins),
  `hr_staff_weekly_availability` (EMPTY — nobody could input it) and
  `hr_staff_availability` (staff web page existed but was gated OWNER/ADMIN).
  Shipped: (1) **generator now respects declared availability** — weekly
  windows (whitelist semantics, same as Assist candidates: rows exist → only
  those days/windows; no rows → flexible), per-date unavailable/off blocks,
  and `max_shifts_per_week` tightening the 5-day cap; applied in BOTH greedy
  filter and the validator (catches LLM proposals). (2) **Generator posts
  unfilled gaps to `hr_open_shifts`** (source `generator`, idempotent per
  outlet+week: still-open generator slots replaced on regen, claimed ones
  untouched) + ai_note "N OPEN SLOT(S) posted". (3) **Staff web**: weekly
  pattern editor on /hr/availability (gate opened to all staff) + new
  /hr/open-shifts page; APIs /api/hr/availability/weekly (replace-wholesale)
  and /api/hr/open-shifts (GET eligibility-annotated list; POST claim =
  ported WhatsApp semantics PLUS 24h/5-day cross-outlet caps + one-outlet-
  per-day, materializes the real shift row). (4) **staff-native**: My
  Availability + Open Slots screens, lib/hr/api.ts fetchers, HR hub tiles
  (NOTE: staff-native merge = OTA deploy — ota-release skill applies).
  **Live-schema catch:** `hr_staff_weekly_availability.available_from/until
  are NOT NULL in prod** (code comments claimed nullable) — "any time" is
  stored as explicit 00:00–23:59; fixed the latent WhatsApp bug where a
  null-window reply violated the constraint UNCHECKED after the delete,
  silently wiping the PT's declared availability. Insert shapes verified
  against prod inside a rolled-back transaction. E2E after deploy: PT sets
  pattern → regenerate a draft week → open slots appear in staff apps →
  book → shift lands on grid; payroll cap already counts claimed slots
  (notes=template_id, not pt_suggestion).

- 2026-07-19 (round 12) — **Published-roster audit vs the AI logic (owner:
  "my staff already done and publish next week schedule... use our
  scheduling logic against what they arrange", then "i found few
  inconsistencies... can you find more?").** Confirmed owner's four (PJ Tue
  7 FOH shifts = +11h over target with mornings still at 2 FOH; PJ Thu +4h;
  PJ Sun FOH −10h on the busiest bar day + kitchen +9h same day; Tamarind
  NO morning cook Tue–Fri and no evening cook Sun). Found more: SA kitchen
  unmanned evening Tue / mornings Wed+Fri; Danish (FT kitchen) scheduled 2
  days with NO leave record (root cause of SA holes; Zikry's 5-day week IS
  leave-backed); PT cap breaches Emran 31h net, Naufal/Fatin/Qaisara 30h;
  SA Mon/Sat/Sun whole-day 2-FOH; Tam Sun morning 1 FOH; 12 clopenings;
  PJ kitchen over target all 7 days while FOH under on 5. Friday prayer OK
  at PJ only. Then reverse-audited for staff logic the AI misses → 4 real
  gaps: rover circuit allocation (Syafiq 1 outlet/day), fixed shift
  identities (Haziq always opener, Aina 12–20), PT truths not in DB
  (weekly-availability table was empty — round 13 builds the input), and
  manager-as-cover placement (Adam parked on the thinnest days; open
  question: should a PUBLISHED manager shift count as coverage?). Audit
  data + engine in scratchpad (published-week-v2.json).

- 2026-07-19 (round 11) — **Weekly PT payment flow: manager sign-off →
  gated per-person payment file.** Owner: "proceed with the payment
  file. also the managers also needs to confirm each PT hours first
  before paying." No migration needed — hr_attendance_logs already had
  final_status/reviewed_by; "confirmed" = final_status approved/
  adjusted. Shipped: (1) **HR → PT Hours page** (manager-scoped, tab in
  the Attendance group): per-PT weekly clock logs with day-aware
  rate/pay preview (weekday/weekend/PH 2×), one-click "Confirm all
  clean" (pending+unflagged), per-log confirm, flagged logs route to
  the existing Attendance review queue; API GET/POST
  /api/hr/payroll/weekly/pt-hours (bulk confirm never overwrites
  adjusted/rejected, manager outlet-gated). (2) **bank-file endpoint
  reworked** (kept URL): run must be finance-CONFIRMED, every closed
  non-rejected log in the week must be manager-confirmed (409 names
  who), missing bank details now BLOCK (the old version silently
  dropped payees), per-person reference "PTW<ddmm> <name>" for
  statement-line reconciliation (kills the outlet lump-sum blindspot
  the finance warehouse flagged); pure builder lib/hr/payment-file.ts
  (+3 tests). Weekly payroll page: fetch-based download with a
  blocker banner (was window.open dumping raw 409 JSON). Flow: manager
  confirms (PT Hours) → finance Compute → Confirm → Payment file →
  bank portal approval → Mark paid.

- 2026-07-18 (round 10) — **PT weekday/weekend rates (owner: "diff
  weekdays weekends... follow and fix the data" + the "Celsius - Part
  Timer 2025/26" Google Sheet).** Sheet forensics (6,047 ledger rows):
  history 2024–early-25 was a clean RM8 wd / RM9 we; current entries
  inconsistent (mostly flat 9, three PTs flat 10, PH entries 18/20 =
  2×). Adopted the one rule that resolves every inconsistency:
  **RM9 weekday / RM10 weekend / 2× public holiday** — stated to owner
  for veto. Shipped: migration 090 APPLIED (hr_employee_profiles.
  hourly_rate_weekend, NULL→base fallback); `lib/hr/pt-rate.ts`
  (ptRateForDate — single pricing fn); day-aware pricing wired into
  weekly PT payroll calculator (per-clock-log rate + PH set from
  hr_public_holidays, rate recorded per shift in computation_details),
  labour-gate costRoster + ptCost, AI Fill PT suggestion costing
  (holidays from weekForecast.byDate), employee page Compensation
  section (weekend field, OWNER/ADMIN-gated, added to PII list).
  Backfilled prod: 28 PT/intern profiles → 9/10 (was 26×9, 1×8, 1×10).
  Earlier same day (rounds 8–9 follow-ups, all merged): #981 week-aware
  Jumaat (Friday rests to prayer-goers, Thursday closing keeps women
  clopening-eligible), #982 cap-cascade + breadth-first PT fill +
  canonical outlet order (Putrajaya→SA→Tamarind→Nilai→IOI via
  lib/outlet-order.ts at 8 endpoints) + Assist tab removed, #985
  kitchen-gaps-first + ⚠ UNMANNED station warnings (Tamarind weekend
  kitchen catch). Open owner decision: Tamarind kitchen supply 12 vs 14
  anchor slots — raise PT cap / cross-train / accept flagged gaps.
- 2026-07-18 — **GRNI namespacing + capture format guard (follow-up PR).** New
  placeholders mint as `GRNI-<outletCode>-<n>` via
  `lib/inventory/placeholder-number.ts` (6 mint sites switched; legacy `INV-#`
  rows still recognised). POP matcher: number lookups now scope to the supplier
  identified by the transfer's bank account, and placeholder-shaped refs
  require amount/payee corroboration (they stay matchable — finance pays off
  the card showing them). Capture: `numberShapeMatchesHistory` flags an
  extracted number whose shape doesn't match the supplier's history
  (NUMBER_FORMAT_MISMATCH flag) — would have caught the TMM/MnM contamination.
  **Photo forensics (both "stolen number" rows read):** TMM CC001 RM509.76 row
  (`ec3496d5…`) carries MnM's IVCT-00012381 photo AND number — its real TMM
  number is unknown (likely paid by the unresolved 7/16 POP ref 9376518471);
  MnM "1-15150" row (`bed3d671…`) is a DUPLICATE of IVCT-00012005 (same photo,
  RM432 6/26) on a second PO — one real Jul-10 payment recorded on two rows.
  Both corrections need owner sign-off (rename-to-true-number turned out
  impossible; proposal = re-number TMM row pending SOA + resolve its POP, and
  void/merge the MnM duplicate pair).

- 2026-07-18 — **POP matcher: found the never-armed QA loop, armed it (PR #986
  branch).** Owner asked "is the matching agent improving itself?" — answer was
  NO: the pop-verifier (LLM judge at matcher dead-ends, pop-verifier-run.ts) had
  0 verdicts ever (env gate never set; registry `procurement_pop_verifier` mode
  off), pop-lessons was behind a second never-set env, and the third dead-end
  (ambiguous → Telegram picker) had no coverage at all — 6/6 PendingPops
  untapped/rotting. Fixed: verifier mode now read from agent_registry
  (shadow=propose+flag, armed=code-gated auto-pay; env =false stays as kill),
  registry flipped off→shadow in prod, every verdict logged to agent_actions
  (measurable improvement), pop-lessons default ON + learns from resolved
  PendingPops (finance's picker choices), loop-watchdog check #6 pings owner on
  PendingPops unresolved >24h. Same PR: number-match narrowing by
  amount/payee/outlet (the "multiple matching invoices" root fix). Still open:
  6 unresolved PendingPops need human picks; TMM/MnM cross-stamped invoice
  numbers (IVCT-00012381 on a TMM row, 1-15150 on an MnM row) need photo-read
  corrections; Tier-1 phantom reverts (~RM2,370) await owner sign-off.

- 2026-07-18 (round 9) — **Friday-prayer staffing rule (Jumaat).** Owner:
  "put opening female on friday to run friday prayer. including non
  muslim. currently only gulaf is non-muslim." `gender` and `religion`
  columns ALREADY existed on hr_employee_profiles (religion is staff-app
  self-service, HR read-only; gender HR-editable M/F) — no migration.
  Backfilled prod: 61 profiles religion='islam', Guraf Lal Joshi
  'other' (exact faith unknown; he can self-correct). Generator:
  `attendsFridayPrayer(gender, religion)` (unknown gender/religion =
  attends — safe default), Friday fillStation sorts prayer-free staff
  into prayer-spanning openings and prayer-goers into closing; ai_note
  per Friday either confirms the rule held or names who's exposed
  (~13:00–14:15) and needs relief. Assist: `friday_prayer` flag + amber
  chip + ~10-point fit penalty on Friday slots spanning 13:00–14:00.
  Gender data now COMPLETE for all rostered staff (owner supplied: PJ 5
  male; SA/Tam/Nilai 10 female + Emran male; only Anwar IOI + HQ Anis/
  Hanis blank). Round-2 owner catch on the regenerated week: rule ran
  but had nobody to prefer — the rest placer had RESTED Aliana on
  Friday (gender-blind WHO) and Iffa CLOSED Thursday so the clopening
  guard blocked her from Friday opening. Fix: Friday rest slots go to
  prayer-goers first (resting a Muslim man on Friday dissolves his
  conflict), prayer-free staff avoid Friday rests, and THURSDAY closing
  prefers prayer-goers so women/non-Muslims stay eligible for the
  Friday open. Lesson: a day-local rule isn't enough — the enablers
  (rest day, previous night's close) must also be steered.

- 2026-07-18 (round 8) — **Rest days are now PER-STATION (this branch).**
  Owner caught the two failure modes in one afternoon: (a) items-share rest
  placement dug holes PT then re-bought the same day ("hurm"/"fix this" —
  Tue got 3 PT while Sat ran short) → #975 replaced it with slack-greedy vs
  demand; (b) #975's day slack was STATION-BLIND: Sunday's barista side is
  the week's lightest so Sunday looked slack, two rests landed there, and
  person-assignment (weekend-debt order) gave BOTH to kitchen crew
  (Amirul+Azmer) on the #2 cooked-items day — 2 BOH for 86 kitchen items
  ("where is your logic?"). Fix: `placeStationRests(group, needOf,
  minOnDuty)` in schedule-generator — BOH FT rests judged only against
  `kitNeedHOf` (Σ kitHeadsByHour) with min 2 cooks/day (structural
  anchors), FOH FT against `barNeedHOf` (bar curve + SERVICE_FLOOR +
  buffer) with min 3; weekend fairness + variety + profile rest days now
  honoured within each station. Also this round (merged #965 #966 #967
  #975): PT ceiling envelope (FT floor ≥18% no longer starves weekends —
  amber publish), consignment_sales into forecast + history clamped to
  yesterday MYT (Nilai/IOI "no data" fixed), FOH/BOH item split in day
  headers, composition line + "Why this staffing?" panel, forecast rank
  explanations. Same PR, two more owner catches: (1) **demand window
  counted days that hadn't happened** — trailing-28d ran to weekStart−1
  with a hard ÷4, so generating on a Friday put tomorrow's (empty) Sunday
  and today's partial Saturday inside the window: Sunday PJ read 86 kit
  items when the true average of the 3 complete Sundays is 114 (−25%,
  always hitting the weekend). Window now clamps to yesterday MYT and
  divides each weekday by its ACTUAL occurrence count. (2) **Managers
  moved outside FOH/BOH** (owner: "their schedule does not consider as
  man hours, but can suggest shifts to cover if possible"):
  `MANAGEMENT_POSITIONS` (manager/AM/HoD — NOT barista lead) in
  labour-gate-lib; excluded from staffedAt (generator gaps), gate
  coverage `have`, candidates kitGot/barGot, and grid day totals; own
  grid section + timeline band + "MGR7.5 cover" tag; Assist now
  INCLUDES managers as bottom-ranked `manager_cover` candidates and a
  manager's + Add offers any short window as cover. Queue awaiting
  owner word: staff-app PT-loop parity, weekly autopilot cron, KDS
  handover briefing, Meta WA templates, demand v3 from timing
  worksheets.

- 2026-07-18 — **Custodian made SELF-DRIVING (owner: "what I wanted is for
  this agent to do this by itself").** Skill gains an **Autonomy ladder**
  (rung 1: code fixes/additive prod derivations/docs — do it; rung 2:
  pre-approved patterns — tier-1 narration+exact-amount re-points, unambiguous
  backfills, the delegated June GL correction once it reconciles to identity
  <RM500/company; rung 3: propose-only; rung 4: human — payroll/payments,
  arming, period close, merges) + procedure step 4b (each run BUILDS 1–3
  backlog items end-to-end, not just reports). Routine changed weekly→**daily**
  21:00 MYT (`trig_015cnJr3bfeXrjQ285nRjXNb`, fresh session; old weekly
  trigger deleted — its prompt contradicted the ladder). **CAVEAT: routine
  carries no MCP connectors (created via meta tool) — if tonight's run
  can't reach Supabase, recreate it from the claude.ai Routines UI.** Close
  pack (monthly) unchanged. Input-quality enforcement shipped same day:
  receiving API persists resolved package (root cause of 71% null coverage),
  accountant valuation pack (docs/proposals/inventory-valuation-anchors.md),
  close-pack COGS trust gates + check 25.

- 2026-07-18 — **Data-warehouse custodian expanded to the WHOLE estate**
  (owner: "this agent should be accountable for all the data"). Skill
  (`finance-warehouse` — historical path, description now estate-wide)
  gains domain contracts + checks 13–20 for HR, procurement/inventory,
  ops, marketing/loyalty, reviews/ads, comms, agent substrate; design doc
  gains the estate baseline + goals; migration 086 (APPLIED) broadens the
  registry row (key unchanged — stable identifier). Baseline sweep
  findings E1–E7: 935 open OpsAlerts; 107 POs AWAITING_DELIVERY (+4 SENT
  stuck, 1 DRAFT Jun 28); **sms_logs last row Jun 21 while SMS loops are
  ARMED** (channel dead or sends moved to push — top estate check);
  campaign_outcomes 0 rows (no loop writes outcomes); geogrid scans
  stalled since Jul 6; only 4/30 registry agents ever wrote
  agent_actions; 2 StockCounts SUBMITTED since Apr 30. Also: payroll runs
  now 6× paid (the 7/5 "all drafts" note is stale; fin_payroll_actuals
  stays canonical for cost). Weekly/close-pack routines inherit the
  estate scope automatically (prompts defer to the skill). **Next run
  priorities:** E3 SMS pulse root-cause, June per-company-day GL
  correction, E1/E2 aging policies.
  **COGS activation designed ("design 1", same day):**
  `docs/design/cogs-activation.md`. Discovery flipped the premise:
  recipes EXIST and are complete (`MenuIngredient`, 92/92 menus, 512
  lines, 138 ingredients, clean g/ml/pcs UOMs — earlier "no recipe
  tables" was a name-pattern discovery miss); `ProductPackage.
  conversionFactor` exists but only 29% of 2,070 ReceivingItems carry a
  package link; **consumption-post.ts reads DEAD SalesTransaction** (the
  shadow engine has multiplied recipes against zero sales since April);
  ReceivingItem has no price — unit cost derives from PO OrderItem.
  unitPrice ÷ conversionFactor. Workstreams W1–W5 (re-point sales →
  package ratchet + product_costs → menu_margins view → variance loop →
  pre-committed arming criteria for consumption_engine). Warehouse
  checks 21–24 added. **W1 BUILT same day (owner: "merge and build"):**
  consumption-post.ts now sources sales from pos_order_items (status
  completed, non-refund) + pickup order_items (paid statuses), both
  joined to Menu via storehubId (demand-model precedent); dead
  SalesTransaction read gone; new `itemsUnmapped` field surfaces items
  with no Menu mapping (live-verified Jul 17: 139–244 pos + 43–82 pickup
  items/outlet, only 3–8 unmapped per stream ≈ 4%). Engine stays SHADOW.
  Note: "Celsius Coffee Putrajaya" Outlet = the Conezion store (slug
  outlet-con) — 3 active till outlets, all covered. **W2/W3/W4 BUILT same
  session (owner: CONTINUE):** migration 087 APPLIED — `product_costs`
  VIEW (cost per base unit from last-5 received PO lines ÷
  ProductPackage.conversionFactor, override table
  product_cost_overrides; no cron — stays clear of the 40-cron cap),
  `menu_margins` VIEW (sellingPrice − channel-weighted recipe cost;
  uncosted_ingredients flags overstated margins; packaging cost = v1
  follow-up), and the W2 single-package backfill (848 ReceivingItems →
  package coverage 29%→70%). Verified sane: pastas RM19.90–29.90 at
  52–74% gross margin; 104/138 recipe ingredients costed (75%);
  data-map "Unit economics" section added. **Remaining in
  cogs-activation:** receiving-flow package default (code+UI), Catalog
  BOM page margin surface, packaging cost in margins, W5 variance loop →
  arming. **Next:** merge PR #970 (W1–W4); first shadow consumption
  report after tonight's cron.

- 2026-07-18 (round 7) — **Measured station capacity v2 (this branch).**
  Owner corrections while auditing Sat Jul 18: (a) "short" units clarified
  (hourly = concurrent heads, day chip = man-hours); (b) serve p90 signal is
  DIRTY at PJ — p50/p90 flat across quiet and busy hours, worst p90 at the
  dead 22:00 (44min) → docket hygiene, not load; (c) THE KEY ONE: staff work
  OVERLAPPING — 10/15min are order-latency promises, not per-item labour
  costs, so the p90 proportional controller (rates 8→4.8, 6→3.6) was
  over-demanding heads. Replaced with measured capacity: per (day,hour)
  items ÷ heads CLOCKED IN (hr_attendance_logs), hours qualifying only when
  median serve met target, p80 = demonstrated capacity, plan at 85%
  headroom, clamps [0.75×, 2.5×] base, base until ≥20 qualifying hours.
  PJ live: barista 11.1/head/hr (85h) → plan 9.4; kitchen 8.0 (82h) → plan
  6.8. Sat Jul 18 audit vs old roster: 12:00 double-middle sits on the
  demand lull while the 9am food peak ran at half strength (owner spotted
  it). Also this round: migration 084 APPLIED to prod; #963 (WhatsApp
  PT-loop flows) MERGED. Pending: staff-app parity screens, weekly cron,
  KDS "mark served at handover" briefing, Meta template submissions.

- 2026-07-18 — **Finance warehouse session 2 (owner-approved actions
  executed).** PR #948 merged; weekly routine scheduled
  (`trig_012njzLdT5jtaUQVG2JSrNgz`, Sun 21:00 MYT) + month-end close pack
  (`trig_017RGBQXACCqkRpQWknETpwW`, day 1 08:00 MYT) — both fresh-session;
  NOTE they carry no MCP connectors (created via meta tool) — if the first
  run can't reach Supabase, recreate from the claude.ai Routines UI.
  Executed on owner approval: (1) **tier-1 re-point batch: 92 bank lines
  re-pointed** (RM30,470.60, audit-stamped, classifiedBy='manual'); check
  11b residual now exactly 41 (tier-2, needs SOAs); the orphaned
  `paidVia='bank-ap-match'`-no-line phantom-paid review list (incl
  INV-1012 RM768, 26-0634/260634 RM148 pairs) awaits finance disposition.
  (2) **Pickup channel added to unified_sales** (migration 085 APPLIED;
  July: 1,347 rows RM41,649.74; view now pos+grabfood+pickup+consignment;
  data-map + skill updated; `unified_sale_items` still lacks pickup lines
  — follow-up; backoffice dashboard lib reads raw tables, unaffected).
  (3) **June unwind NOT applied — blanket reversal would be WRONG:**
  day-level reconstruction shows over-counting (Tamarind Jun 6–17, SdnBhd
  Jun 6–14: EOD posted full StoreHub days while bank-fed income ran) AND
  under-counting (Conezion Jun 8–17, SdnBhd Jun 15–17: EOD captured only
  pickup ~RM400/day, till ~RM3k/day went nowhere). Net error much smaller
  than the RM81k upper bound. Owner delegated ("make sure it is right") —
  per-company-day correcting entries are the weekly run's top item.

- 2026-07-16 -- **Finance data-warehouse agent designed** (branch
  `claude/celsius-finance-warehouse-agent-8j1uk6`): new `finance-warehouse`
  skill (custodian runbook: data contract w/ SLOs, 12-check suite, drift
  scan, close pack, `claude/finwh-` draft-PR findings loop) +
  `docs/design/finance-data-warehouse-agent.md` (verified 2026-07-16
  inventory, backlog F1–F7, 8 candidate goals — recommended starting set:
  freshness SLOs, lens bridge, restore eval dataset, month-end close) +
  migration 083 seeding `finance_warehouse` into agent_registry (shadow,
  **NOT applied** — human applies). **F1 root-caused + partially fixed in
  the same PR:** categorizer sits on the dormant `/api/finance/bills/upload`
  pipeline (fin_documents/fin_bills empty — never used; the live AP flow is
  procurement invoice-capture, which never calls it), and
  `logDecision`/`markDecisionApplied` swallowed supabase-js errors. Shipped:
  error handling fixed; ap-verifier (the live 6-hourly/EOM gray-zone judge)
  now logs every verdict to fin_agent_decisions (agent='ap-verifier',
  related_id=bank line, applied=true on committed EOM applies). Remaining
  F1 work: log invoice-capture extraction decisions + wire draft-invoice
  edits to recordCorrection (correction-shape design needed).
  **Run 1 executed 2026-07-17 (owner-triggered; migration 083 APPLIED to
  prod same session on owner instruction — finance_warehouse registered,
  shadow).** 9/12 checks green (ledger balanced, no orphan COA codes,
  cutover exclusivity exact, traps empty, 0 uncategorised bank lines).
  Findings: (W1) the wrong-invoice bank-match backlog is precisely **133**
  lines (check 11b query now canonical; was "~113"); (W2) 6 invoices
  paidVia='bank-ap-match' have NO linked bank line (inconsistent state,
  incl INV-1012 RM768 paid 6/16) + 95 Maybank-Transfer PAID (RM58k)
  awaiting EOM reconcile — 564 other unlinked are benign
  historical/backfill; (W3) **unified_sales.sst is dead — all-zero for all
  time** (data-map corrected; never compute SST from the till lens);
  (W4) drift: 082 fin_inventory_valuations was missing from the
  contract/data-map (added) and the table is EMPTY — Bukku Q1-close
  anchors never entered (owner/accountant action if the sourced P&L needs
  them). June lens bridge formalised: till 285,363.17 vs GL 353,851.53 =
  gap 68,488.36 → Grabfood 41,838.89 + GastroHub 12,441.54 + residual
  14,207.93 (~5%) ≈ card settlement lag — quantify next run (per-day card
  tender vs 5000-02). All findings logged to agent_actions.
  **Run 2 (same day, owner-triggered "continue"):** the lens bridge is now
  SOLVED — the GL income lens changed semantics at the POS cutover:
  5000-01/02/04 are EOD-journal-fed (accrual at ring-up) since ~Jun 6–18,
  bank-fed before; verified Jul 1–14 EOD income = till(pos+grabfood) +
  pickup-app − consignment with residual RM48; Grab delivery payouts now
  post to 1005 transit (not income). **Two material findings:**
  (1) JUNE GL income is mixed-regime — both bank-fed AND EOD posted income
  Jun 6–17, up to RM81,270.74 double-counted; unwind needed while the
  period is open (do not trust June GL revenue until then).
  (2) unified_sales VIEW excludes the pickup app (~RM40k/mo; `orders`
  money columns are in SEN) — "only sales truth" corrected in data-map.
  Re-pointing batch prepared propose-only in
  `docs/proposals/finwh-repoint-133-wrong-invoice-matches.md`: tier 1 = 92
  exact-amount narration matches (RM30,470.60, gated SQL), tier 2 = 41
  manual (RM21,251.98). **Next:** merge PR #948; owner/finance decisions:
  approve tier-1 re-point batch, June double-count unwind plan, whether to
  add pickup channel into the unified_sales view; schedule the weekly
  routine.
- 2026-07-17 (round 6, IN PROGRESS) — **PT loop build started
  (docs/design/pt-loop.md).** Merged this round already: #960 (PT gaps +
  targets from the demand model, station-tagged, structural anchor gaps)
  and #961 (demand model counts pickup-app `orders` — SA was missing 65
  items/day incl. +70% cooked workload; joins Menu via storehubId).
  Owner-driven PT-loop requirements: availability has NO write UI today
  (hr_staff_weekly_availability verified 0 rows), reserve empty spots as
  claimable open shifts, roster acknowledgment mandatory — over WhatsApp
  (Cloud API infra already wired: lib/whatsapp.ts + webhook) AND staff-app
  parity. Bilingual PT SOP memo drafted (sent to owner, start date TBC).
  Migration 084_pt_loop_ack_open_shifts.sql written (ack columns,
  hr_open_shifts, hr_wa_prompts; RLS enabled no policies per house rule) —
  NOT applied to prod yet, awaiting owner approval. Build order in
  pt-loop.md; next: WhatsApp flows PR, then generator open-shift emit,
  staff-app screens, weekly cron. Meta template approval needed for
  outside-24h pings — submit early.

- 2026-07-17 (latest) — **Round 5: forecast clamp (merged #959) + PT
  allocation unified with the demand model (this branch).**
  (a) #959: forecast history window now ends at YESTERDAY (MYT) — forecasting
  next week mid-week had been zero-filling the not-yet-traded tail of the
  current week at the highest recency weight, cratering Sat/Sun forecasts
  (SA/PJ Saturday showed ~RM3.0k vs real ~RM4.9k baseline). Surfaced by the
  owner asking how the weekend forecast works.
  (b) Shah Alam full-week QA (draft 2026-07-20) validated BOH: kitchen at
  open+close all 7 days, zero kitchen middles, no clopening, 45h caps, rover
  2 days, manager never rostered. But Mon–Wed FOH sat below the 3-head floor
  with NO PT suggested: `ptTargetByDate` still used the old
  items-per-man-hour "required" formula that disagreed with the coverage
  chips. Fixed: PT gaps + day targets now come from THE demand model
  (station-split heads incl. floor + mode buffer), gaps are station-tagged
  (kitchen holes only offered to kitchen-capable PT; hybrid "PT
  Barista/Kitchen" fits both), and structural anchor gaps (2/station on
  opening & closing) let PT complete the 2/2 kitchen anchors when only 3
  kitchen FT exist (Haziq → kitchen Closing instead of a random Middle).
  Greedy fallback, model-proposal validation, and the PT model prompt all
  enforce/see the station. Next: autopilot phase 2 (weekly cron
  generate→validate→shadow-publish) awaits owner "continue".

- 2026-07-17 (later) — **Scheduler round 4: per-station allocation + Assist
  rebuilt (PR #957, branch `claude/staff-rotation-outlets-kmobpa`).** One
  demand model (`lib/hr/demand.ts`, extracted from the generator) now feeds
  generator + labour-gate coverage + grid "short Xh" chips + Assist. Owner
  directives closed this round: (1) BOH middles were surplus artifacts —
  day-split now runs `allocateShiftCounts` **once per station** (kitchen crew
  on the kitchen item curve, FOH on the barista curve + service floor + mode
  buffer; pastries/croissants/cakes/cookies are barista — verified against
  live Menu categories, only the 6 cooked categories are kitchen). Owner
  refinement: anchors are STRUCTURAL for both stations — open carries
  prep/setup, close carries cleaning + dishwashing — so each station seeds
  up to 2 opening AND 2 closing (`allocateStationCounts`,
  STATION_ANCHOR_TARGET=2; 1 head opens, 2→1/1, 3→2/1, 4→2/2) before its
  item curve places anyone; only heads beyond 4 follow the curve
  (regression-tested in shift-allocation.test.ts). (2) Assist QA'd — it was NOT following the same
  logic: it ranked the Manager as Top pick (pool now excludes
  Manager/AM/HoD; Barista Lead stays), its coverage chips read
  hr_outlet_coverage_rules with a min-concurrent-over-16h bug ("0/4 short 4"
  with 11 rostered) — chips are now per-template needs from the demand model
  with per-station gaps ("short 1 kitchen + 1 barista"), and clicking a
  single-station gap auto-fills the role so skill-weighting favours that
  station. (3) UX: grid cell "+ Add" now leads with "✨ Suggested" — the
  short templates for that person's station, one click to assign (lazy
  per-date fetch of /api/hr/schedules/candidates, cache cleared on save).
  Remember the deploy-lag gotcha before believing "it didn't work".
  Still open: two deep-QA review agents from round 3 never reported back;
  autopilot phases 2–4 (cron generate→validate→publish shadow-first,
  WhatsApp exception digest, PT auto-commit) designed but not built.

- 2026-07-17 — **Scheduler QA round 3 (owner-driven), all merged to main.**
  #953 (squash `9544c2f`): day-split rebuilt — shift COUNTS from the hourly
  items curve via `lib/hr/shift-allocation.ts` (marginal-shortfall greedy;
  killed the clopening cascade that starved opening at 2 / stacked closing
  at 6); all FT filled in every mode (shared FT to 6-day combined cap, rover
  2 days); Managers/Area Managers never auto-scheduled; rotation cost follows
  hours (`borrowedFtCharge`/`lentFtCredit` — borrowed FT charged here,
  credited at home; Barista Lead pro-rata; manager cost = HQ RM0, flat RM309
  rover share dropped); generator uses real per-profile EPF rates; daily grid
  % = day's hours-share of ACTUAL roster cost (reconciles to the weekly chip).
  Verified live: all FT/PT salary data individually populated; Afique
  RM1,900 → RM438/wk charged where he works. **Gotcha that bit twice:** owner
  regenerates immediately after merge, but Vercel prod deploy lags ~3-6 min —
  check `ai_notes` for the current marker line (now "rotation cost follows
  hours") before diagnosing "the fix didn't work". Follow-up branch adds
  FOH/BOH section grouping in the week grid. Two deep-QA review agents were
  still in flight at last update — triage their reports on return.

- 2026-07-16 — **Ads optimizer + local-rank status check (all DB-verified,
  follow-up to the 2026-07-05 entry).**
  **Optimizer:** the two Jul 5 owner-approved cuts (Tamarind RM100.20→84.96/day,
  Putrajaya RM100→98.42/day, ~RM504/mo freed) applied clean and are sticking —
  per-day cost/conv Jul 5–14 vs the prior 2 weeks: Tam RM13.4→9.4, PJ RM9.4→7.6,
  SA (uncut) RM6.2→6.1, with conversions/day flat-to-up at all three. No further
  budget changes; 0 search-term exclusions ever used. July spend to date
  RM7,296 (3 campaigns ≈RM100/day each). **BUT the conversion signal is still
  wrong:** `ads_conversion_daily` confirms the tracked actions are *Local
  actions – Directions* + *Clicks to call* (and that per-action sync is stale —
  no rows after 2026-04-19). The value-based "Pickup Order" tag
  (`docs/design/ads-conversion-loop.md` Approach A) was never wired, so the
  optimizer's efficiency lens = cost per directions-click, not cost per order.
  **ads-daily sync** healthy nightly (metrics through Jul 14) EXCEPT the
  search-terms step: its sync-log rows are stuck `RUNNING` every night (finish
  update never lands) and Jul 12 threw a hard Prisma connection-pool timeout;
  data still arrives (10.5k rows / 4.9k terms, Jun 29→Jul 13) — likely serial
  upserts racing maxDuration/pool. Owner's search-term **backfill curl never
  ran** (history starts Jun 29). The Monday shadow-optimizer report exists only
  in the cron's JSON response — persisted nowhere, read by no one.
  **Geogrid:** the first true-10km auto-scan (Mon Jul 6) burned the ENTIRE
  monthly cap in one run — 40 scans: 13 complete / 7 partial / 20 failed with
  0/81 points (later scans in the run all failed → Places quota/rate
  exhaustion; failed scans still persist rows and count against
  `GEOGRID_MONTHLY_SCAN_CAP`). The Jul 13 Monday run was a capped no-op;
  **nothing scans again until Aug 1.** Structural mismatch: 86 active
  keyword×outlet combos on a ~weekly due-cadence vs a 40/month cap — the loop
  as configured can never complete a sweep. Tamarind got ZERO usable catchment
  baselines. Usable Jul 6 baselines: SA "breakfast shah alam" avg 3.9 / 33%
  top-3 / green 11.2km; PJ "cafe" 5.3 / 12% / 5.0km; Nilai "nilai cafe" avg
  17.2 / 0% top-3 (invisible in its own town).
  **Reviews (the rank lever):** snapshots current through Jul 16. 30-day
  velocity: Tam 49 (the GBP relink fix is vindicated), PJ 29, SA 13, **Nilai 3
  — still the binding constraint** (111 reviews vs top local competitor 160).
  **Substrate gap:** none of ads-daily / optimizer / geogrid are in
  `agent_registry` (only the `reviews_*` agents) — no kill switch, no ledger.
  **GBP category adds** (the Jul 5 "next") were never proposed — blocked on
  the failed scan coverage.
  **Next:** (1) fix geogrid scan economics — don't count failed scans against
  the cap, throttle within a run, and prune the 86-keyword set to fit the
  budget (or raise the cap knowingly: ~81 Places calls/scan); (2) owner
  decision: wire the value-based Pickup Order conversion (Approach A) or
  accept directions-clicks as the metric; (3) re-propose GBP category adds
  once Tamarind has a real catchment scan. (Items on the optimizer shadow
  report, search-term batching, and registry registration were superseded the
  same day by the ads autopilot — next entry.)

- 2026-07-21 — **Negative-keyword CONSOLIDATION (owner: "check if there is
  still bad keywords paid" → "go ahead").** Found all 3 campaigns at 25/25
  negative slots with ~RM170/mo junk still paid + stuck (slots full → last 2
  runs excluded 0). Root cause: slots burned on literal near-dupes. Fix:
  exclude broad ROOTS not literals (`negativeThemeRoot`/`exclusionPhrase`;
  "zus" covers "zus near me"+"zus coffee" fuzzily + pre-blocks future
  variants), `selectAutoExclusions` sums spend per root, one-time idempotent
  `consolidateCampaignNegatives` swaps existing 25 literals→roots in the armed
  nightly pass (removes literals=frees slots, adds roots, ledger
  status='superseded'). Verified: applied exclusions DO stop spend (≤RM1.89
  one-day propagation tail, not a leak); sync healthy (Google's ~2-day
  search-term reporting lag, latest data Jul 19). Root lists exclude bare
  "coffee"/"cafe" so café intent is never blocked. 483 tests green.
- 2026-07-21 — **Hard-cut APPLIED + EFFECT.** Jul 20 run cut all 3 campaigns
  to RM55/day clean (fleet RM265.86→165). Cuts banked RM4,056/mo = 81% of
  RM5k. Till post-cut Jul 21 = RM6,660 fleet, inside normal RM6.5–8.4k band —
  no cliff, but 1 day (guard verdict ~2wk). Scoreboard sales side still
  contaminated (StoreHub anchor, shows −RM10.6k/mo — ignore). Owed: remove the
  one-time hardCutDirective block; fix scoreboard anchor; if till holds, take
  fleet toward RM45/day each for the last ~RM950/mo.
- 2026-07-19 — **Hard-cut directive (owner: "what do you suggest" → "ok do
  this"):** one-time decisive cut of all 3 ad campaigns to RM55/day
  (`hardCutDirective`, env ADS_HARD_CUT_TARGET_MYR) — banks ~RM4,050/mo of
  the RM5k target at once instead of over ~2 months, then the normal guarded
  descent + rollback continue. Fires only on a healthy measured till (raw
  index ≥0.95; a weak/unmeasured outlet waits a night), only while >target,
  self-expires per campaign at RM55. My reasoning: 11% cut so far moved the
  till 0 → strong evidence marginal spend is waste; RM55 (not the floor)
  keeps a real budget each outlet can defend so a genuine sales effect shows
  up as a manageable dip, not a cliff. **Remove the directive block in a
  follow-up once all 3 are confirmed at RM55.** Fleet after tonight: 265.86→
  165/day.
- 2026-07-19 — **Descent aggression BUMPED (owner: "decrease more")** after
  first cuts proved safe (fleet RM300.20→265.86/day = RM1,030/mo banked, ~21%
  of RM5k; per-outlet guard healthy; clean-POS till flat ex-Shah-Alam which
  tracks the Grab holdout + seasonality). Steps 8→12% (inefficient 12→18%),
  max cuts/run 2→3, fleet spacing 6→3d; all env-tunable (ADS_STEP_PCT etc).
  OBSERVE_DAYS kept 14 (= guard window). NOTE: the cash scoreboard's SALES
  side is contaminated — its anchor window (28d pre-Jul-5) straddles the
  StoreHub→pos-native cutover, so it over-reads the "before" till (logged
  -RM9.9k/mo till Δ vs clean-POS ~-RM170/day). Cuts side is correct. Fix
  offered (anchor to post-cutover window / exclude storehub_sales), owner
  hasn't said go yet.
- 2026-07-19 — **Cash TARGET (owner, revised): +RM5,000/month net from
  GOOGLE ADS ONLY** (was RM7k any-source; SMS/loyalty loop proposed and
  PARKED — 23k member phones sized, design in sms-loop-engineering.md,
  awaiting owner's return to it). Nightly `cashScoreboard()` in the autopilot logs
  progress (cuts vs RM300.20/day pre-descent baseline + margin on fleet till
  drift vs the pre-descent anchor) in every run's summary + meta. Current:
  ~RM1,030/mo banked from cuts (~15%). Cuts ceiling ≈RM6.4k/mo → the sales
  side is required; biggest dormant lever = value-based Pickup Order
  conversion tag (still unwired).
- 2026-07-18 — **Ads spend autopilot LIVE — full design + history promoted to
  `docs/design/ads-autopilot.md`** (PRs #947/#952/#954/#971/#972/#973, all
  merged; built 7/16-18 from owner directives: no per-change approval,
  maximize cash with the till as sole truth, exclude junk then cut its cost,
  full-pause Tamarind for a baseline). Nightly inside `cron/ads-daily`;
  kill switch `agent_registry` key `ads_autopilot` (armed); every action in
  `ads_budget_change`/`ads_term_exclusion` as decided_by='ads-autopilot'.
  **Live state after the first run (Jul 18 3am MYT, ledger-verified):**
  Putrajaya RM92.79/day (waste-matched cut paired with its 15 junk-term
  exclusions), Shah Alam RM92 (first blind 8%), Tamarind RM100.20 (rollback
  that channel-decomposition proved a FALSE POSITIVE — till flat in absolute
  RM; led to the #972 plausibility bound). 45 negatives applied incl. fleet
  seeds to SA/Tam. **Tamarind pause was BLOCKED twice** (Jul 18: probe gate required a fully
  healthy guard, fixed in #973; Jul 19: the human-paused NILAI campaign
  tripped the one-probe-at-a-time check, and nightly waste-matched cuts
  were resetting the fleet-spacing clock — starvation bugs). Fixed: the
  one-probe check counts only autopilot-paused campaigns; waste-matched
  cuts don't reset the spacing clock; pauses are never spaced. **PLAN CHANGED (owner,
  Jul 19): pause probe SHELVED — "let tamarind follow the others, start with
  the prev cut (rm80+)". One-time owner directive in code cuts Tamarind
  100.20→84.96 at the next nightly run (self-expiring: fires only while the
  false-positive rollback is the last ledger row), then Tamarind runs the
  same gradual descent as PJ/SA. Probe machinery kept, re-enable via
  ADS_AUTOPILOT_PAUSE_PROBE=on.** (Superseded text: Tamarind 28d baseline
  (probe gate now blocks only on absolute till weakness, #973) →
  auto-restore + verdict ~Aug 15 — drop → ads generate cash; none → floor.) Competitor + dessert
  junk classes armed (owner: no conquesting), Malay/local vocab added,
  25-negative-slot budget per campaign. **Watch items:** Tamarind verdict
  ~Aug 15; SA/Tam term data accumulating (waste-matched cuts follow);
  fuzzy negative themes may catch café-intent terms (seen: "kopitiam near
  me") — reject via /ads/optimizer panel to make it permanent; possible
  GrabAds holdout at SA/Tam is a confound for till reads. **Still open
  (owner):** value-based Pickup Order conversion tag (Approach A) — Google
  still optimizes toward directions-clicks; geogrid scan-cap economics
  (separate loop, idle until Aug 1).

- 2026-07-15 -- **Staff-scheduling round 2 (branch
  `claude/staff-rotation-outlets-kmobpa`, PR #938, draft).** Builds on the
  merged #934 (multi-outlet rotation + demand-sized AI Fill + fairness). Two
  additions: (1) **Tight/Mid/Safe staffing-mode toggle** — a coverage buffer on
  top of the demand-sized heads via one lever `bufferHeads(dow,hr)` in
  `schedule-generator.ts` (tight=0 → byte-for-byte prior behaviour; mid=+1 across
  the day's peak block; safe=+1 all open hours). Chosen in the Schedules toolbar
  dropdown beside AI Fill; validated in `api/hr/schedules/route.ts`; recorded in
  `ai_notes` + returned on the result. (2) **Performance-aware PT suggestions** —
  new `lib/hr/pt-performance.ts` computes a 60-day reliability score (on-time from
  `hr_attendance_logs` 60/40 checklist-completion from `Checklist`, Bayesian
  prior 0.7-0.8/K3, never a hard gate); folded into both the greedy fallback
  (blend perf 0.5 + live-fairness 0.35 - cost 0.15) and the LLM prompt. Docs:
  `docs/design/staffing-model.md` updated. No schema change (break *times*
  deliberately out of scope — placed case by case). All 354 tests + tsc + lint
  green. **Next:** await CI on #938, then a live test-generate of one week per
  mode to eyeball the labour% deltas before marking ready.
  **Round 2b — revenue forecast rebuilt.** Diagnosed why AI wk 7/20 read 20.5%
  at fewer hours than published wk 7/13 at 18.2%: labour% = cost ÷ forecast, FT
  salary is a fixed sunk cost (RM4,616 + rover 309 = RM4,925, unmoved by hours),
  and wk 7/20's forecast was ~16% lower (RM23,814 vs ~RM28,500) because the flat
  trailing-28d÷4 forecast lagged a falling trend → PT envelope computed to RM0
  (no PT suggested). Fix: new `lib/hr/revenue-forecast.ts` (pure, 6 tests) —
  per-weekday, recency-weighted (½-life 2w), holidays excluded from baseline +
  applied to target week via the outlet's own holiday ratio. Wired into
  `labour-gate.ts` (`dailyRevenueSeries` + `forecastWeek`; gate `coverage[]` now
  carries per-day forecast/pct/weekend/holiday) and the generator (per-DATE
  affordable man-hours + holiday note; one forecast feeds both sizing and the
  envelope). UI: per-day forecast + indicative % in the week-grid day headers and
  the DayView badge. Verified new query reproduces the old flat forecast to the
  ringgit (flat-weight == 28d÷4). All 360 tests + tsc + lint green.
  **Round 2c — FT sunk cost made explicit.** Because FT salary is booked whether
  or not they're rostered, benching an FT to cut the % saves nothing. Gate now
  splits rosterCost into `ftFixedCost` (FT+rover, sunk) + `ptCost` (discretionary),
  the labour-chip tooltip shows FT-floor% vs PT%, and it warns when a primary FT
  is scheduled ≥2 days below their 6-day capacity (net of leave). Generator flags
  a revenue-constrained week (FT floor alone ≥ target, PT envelope RM0). Cross-
  outlet FT lending noted as the larger follow-up (not built). **PR #938 merged
  to main 2026-07-15** (squash) → Vercel backoffice deploy.
- 2026-07-15 — **Stock-count coverage guard (short-count guardrail).** Root: the
  staff submit/finalize endpoints trust the client's item list; the only
  completeness check was per-item (`countedQty` null), which can't catch products
  never loaded onto the sheet — how Putrajaya's monthly landed at 49 of ~212
  (an abandoned 7-minute DRAFT; its Apr 30 monthly had 212, May/June monthlies
  skipped entirely). New pure `evaluateCountCoverage` in `packages/db/stock-count.ts`
  compares counted vs the outlet's expected universe for that frequency; interim
  baseline = the fullest recent REVIEWED count of the same frequency
  (`apps/staff/src/lib/stock-coverage.ts`). Owner call (block vs warn): **MONTHLY
  below 85% coverage → BLOCK** (unless an explicit `partialReason`, which routes it
  to review with a note); **DAILY/WEEKLY → WARN** (allow but force SUBMITTED +
  short-count note, never auto-approve). Wired into both entry points
  (`api/stock-checks` POST + `.../[id]/finalize`). 14 unit tests green, staff tsc
  clean. **Follow-ups (not built):** backfill `OutletProduct` (has per-product
  `countFrequency` — the real source of truth vs the interim baseline) and seed
  counts from it; an ops-pulse detector to ping on any submitted short count; UI
  progress vs the expected universe ("49 / 212") + a "Submit partial count" action.

- 2026-07-15 -- **Agent substrate SHIPPED end-to-end.** Fleet review found the
  non-compounding pattern (every domain reinvented flags/queues/telemetry;
  shadow builds never armed; marketing loop has no outcome memory). Built the
  shared rails: migrations `080_agent_substrate.sql` (agent_registry +
  agent_actions ledger + campaign_outcomes) and `081_agent_registry_seed.sql`
  -- both **APPLIED to prod 2026-07-15** (29 agents: 17 armed / 8 shadow /
  4 off; advisor shows only the intended RLS-no-policies deny-all note). Lib
  `apps/backoffice/src/lib/agents/substrate.ts` (getAgentMode fail-safe off
  for NEW agents, getAgentModeOrDefault fail-open for pre-existing live
  loops, logAgentAction never throws); `/agents` control panel (Settings >
  System > AI Agents, OWNER/ADMIN; API refuses mode=armed while
  arming_criteria is NULL). Exemplar wiring: celsius-overview +
  reviews-auto-reply log to the ledger; ap-match-apply + gl-post gained
  their first kill switch (registry mode, fail-open armed). NOTE: main's nav
  moved to `apps/backoffice/src/lib/nav.tsx` -- the AI Agents entry lives
  there, NOT in layout.tsx. Compounding build contract now gates new agent
  ideas via the office-hours skill (Phase 1.5) + design-doc "Compounding
  Contract" section. Branch `agents-substrate`. Human owes: arming criteria
  for the 8 shadow agents. Next: wire round_gap_loop + sms_lifecycle_loops
  to campaign_outcomes; migrate legacy env-flag readers to getAgentMode.

- 2026-07-14 — **Housekeeping agent designed** (branch
  `claude/housekeeping-agent-design-p3ux4g`): new `housekeeping` skill —
  evidence-gated cleanup loop on the sentry-triage pattern (fresh session
  per run, state in GitHub via `claude/housekeep-*` draft PRs, ≤3/run,
  propose-only for DB/infra/product-behaviour, human-only for
  payments/secrets). Design: `docs/design/housekeeping-agent.md`. Seeded
  backlog: stale launch.json, root package.json dead scripts
  (`typecheck:apps`→apps/loyalty, `db:push` footgun), staff-native coach
  helpers (ride-along), STATE compaction; propose-only: pickup inventory
  tab. Round 2 (owner): added the **utility audit** — a monthly zombie
  sweep (working-but-unused / purpose-defeating: shadow limbo, producers
  without consumers, half-built loops, noop resolvers) judged on
  usage/outcome evidence, propose-only, verdicts arm/kill/park-with-
  expiry/keep, seeded zombie register in the skill. **Next:** merge,
  then trigger the first run on demand; schedule the weekly routine
  (Sun AM MYT) only after run 1 proves useful.

- 2026-07-14 — **Paid-no-POP audit → 6 payment-record corrections applied to prod**
  (owner-approved in chat; SQL via Supabase MCP, audit notes stamped on every
  touched row, re-pointed bank lines set `classifiedBy='manual'` so the matcher
  won't re-touch them). Verified against the bank feed (current through Jul 12):
  KLFC **00653452** RM768 reverted PAID→PENDING (phantom bank-ap-match — paid
  stamp Jun 16 predates the Jun 19 issue date; that debit narrates 00652052);
  KLFC **00655541** RM768 stalled INITIATED→PENDING (initiated but never
  confirmed; no debit names it, zero unmatched RM768 since Jun 1); Blancoz
  **26-0677** RM148 reverted PAID→PENDING (the Jul 8 debit narrates 26-0676);
  bank lines re-pointed/linked by narration: Jul 5→26-0644, Jul 8→26-0676,
  Jul 10→26-0675 (and 26-0675 paidAt corrected Jul 5→Jul 10). Net: RM1,684 back
  in payables (KLFC 1,536 — cross-check their SOA before paying — + Blancoz 148).
  These 6 are the first slice of the ~113 historical wrong-invoice matches; the
  bulk re-pointing pass still needs its own finance-approved run.

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
  Status refreshed 2026-07-16 — see that entry below for where the loop
  actually stands (scan cap exhausted, conversion signal still wrong).

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
