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

_Format: `YYYY-MM-DD — <symptom> — <evidence> — <hypothesis/fix> — <blocking?>`_

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

- 2026-07-16 — **Ads spend AUTOPILOT built + armed** (same branch/PR #947,
  owner directives in chat: "no need human approve... cut the spending lowest
  possible without reducing the till revenue", descend from 100% — no pause
  test; then widened same day: "ads spend should be generating cash... the
  till is the source of truth... trimming is just the first step, next is to
  find the best way to increase cash"). New
  `apps/backoffice/src/lib/ads/autopilot.ts`, runs inside `cron/ads-daily`
  NIGHTLY (owner: no reason to wait for a weekday — actions are self-paced by
  the ledger: per-campaign observation windows + a 6-day fleet-wide stagger
  for new disturbances, while rollback/revert/restore fire the first night
  the till says so), replacing the response-only shadow report. **Objective =
  cash: till lift × margin − spend; bidirectional extremum-seeker, burden of
  proof asymmetric (cuts stand unless the till proves harm; raises revert
  unless the till proves lift).** State machine per campaign, memory = the
  `ads_budget_change` ledger reason prefixes (no new tables): DESCEND →
  step-down 8% (12% when cost/conv >1.3× fleet-best), ≥14d observation, max
  2 cuts/run (least-efficient first), hard floor RM20/day
  (ADS_AUTOPILOT_FLOOR_MYR); guard breach after a recent cut → ROLLBACK one
  step + 56d hold (= proof of response); then PROBE UP +15% (28d observation,
  cap 1.25× the highest ledgered baseline, ADS_GROSS_MARGIN=0.6 states each
  raise's break-even in the reason) — kept only on detectable lift (fleet-adj
  ≥1.02 AND raw ≥1.0, or immediate revert on breach), else REVERT → SETTLE 90d
  at the proven optimum before re-searching.
  **Round 2 (owner-approved after the step-size math):** gradual steps
  (8–15% of ~RM100/day) move a ~RM2.5-3k/day outlet's till by <1% — per-step
  unreadable; a FULL pause is the only readable experiment (~5-6% if
  break-even). So: **PAUSE PROBE** — one clearly-inefficient campaign at a
  time (cost/conv >1.3× fleet-best, never re-probed, never started into a
  weak till) is PAUSED for 28d (`pause-campaign.ts`, ledger reasons `autopilot
  pause`/`autopilot restore`), the others keep descending as controls
  (Putrajaya + Shah Alam stay gradual per owner), then auto-restored with a
  verdict measured against a forecast built from PRE-pause history: till
  dropped (raw <0.95 / adj <0.97 over the pause window) → ads generate cash,
  resume prior budget + descend; no detectable effect → below break-even
  wholesale, restore at floor RM20/day (~RM1.9k/mo freed at Tamarind). First
  probe will select **Tamarind** (ratio ~1.5; PJ 1.24 is under the 1.3 bar).
  **Boiling-frog fix:** the guard now also carries a fixed ANCHOR — outlet's
  share of fleet till revenue in the 28d before the first ledgered budget
  change vs its share now; anchor <0.93 = breach → rollback. This catches
  cumulative slow damage that the trailing 4-week forecast would otherwise
  normalize into the baseline. **PR #947 MERGED to main 2026-07-16** (squash
  a113464) → autopilot live from the next nightly ads-daily run.
  **Round 4 — waste-matched cuts (owner: "remove the keywords that are not
  worth, and reduce the budget based on the keywords removed... so at the
  starting point we do things right").** Descent priority reordered: while a
  campaign carries excluded-term spend not yet taken out of its budget
  (exclusion ledger rows with `appliedAt` after the campaign's last budget
  change, sized from `est_monthly_saving_myr`), the next cut removes exactly
  that daily amount (min RM0.5/day, cap 20%/cut) — café-intent funding is
  untouched by construction; the blind 8/12% step only resumes once no unpaid
  waste remains. Round 4b (owner: "why can't we cut it now rather than
  wait?"): waste-matched cuts are PAIRED BOOKKEEPING, not experiments — they
  run in the SAME run as the exclusions (exclusions now apply before budget
  decisions; only successfully-applied ones count toward the cut) and are
  exempt from the observation window, the 6d fleet stagger, and the
  2-cuts/run cap. Still gated by: the revenue guard (never cut into a weak
  till), the floor, and rollback coverage. Net effect: the night this
  merges, Putrajaya gets exclusions + the matched ~RM13/day cut together —
  no 5-day wait. PR #952 MERGED 2026-07-17 (squash a3c3015).
  **Round 5 — seeded exclusions (owner: "shah alam, do junk-term as well").**
  Junk intent is fleet-wide: any term actually excluded from measured spend
  at one campaign transfers as a negative to every other enabled campaign
  (`selectSeedExclusions`; evidence-based only, never invented terms; paused
  campaigns skipped; cost recorded NULL so seeds never size a waste-matched
  cut — SA's budget cut waits for its own term data or blind descent).
  **DEPLOY-TIMING LESSON:** the Jul 16 19:00 UTC cron ran the PRE-#947 code —
  the prod deploy of a113464 only went READY at Jul 17 00:13 UTC (~6h after
  merge; queue lag), so the autopilot's real first pass is the night of
  Jul 17 (3am MYT Jul 18): Tamarind pause + Putrajaya exclusions + matched
  cut + SA seeds all together. When a merge must beat a cron, VERIFY the
  Vercel prod deployment is READY — merging is not deploying.
  **Revenue guard:** last-14-full-days actual till revenue ÷ same-window
  forecast (labour-gate `dailyRevenueSeries` + `buildWeekForecast`, history
  precedes the window = clean counterfactual), divided by the median of the
  other ads outlets' indexes to cancel fleet-wide shocks; breach = raw <0.95
  OR fleet-adj <0.97 → roll the last recent cut back one step + 56d hold on
  that campaign ("descent floor found"); breach with no recent cut → hold
  (never cut into weakness); no guard signal → never act. **Term
  auto-exclusions** (`term-rules.ts`): own-brand + non-café food intent only,
  ≥RM2/30d, ≤15/campaign/run; competitor coffee brands + dessert/ambiguous
  NEVER auto-excluded (strategy calls); human `rejected` ledger rows are a
  standing no. All actions land in the existing `ads_budget_change` /
  `ads_term_exclusion` ledgers as `decided_by='ads-autopilot'` (undo paths
  unchanged) + a summary row in `agent_actions`. **Kill switch:**
  `agent_registry` key `ads_autopilot`, fail-safe off — row seeded ARMED in
  prod 2026-07-16 (migration 083, applied via MCP; inert until this code
  deploys). Also FIXED the search-terms sync: batched unnest upserts (500/chunk)
  replace the per-row upsert loop that exhausted the pool after the first
  account — Shah Alam + Tamarind term data starts landing on the next nightly
  run (their history begins ~Jul 17; exclusion candidates there build up over
  the following weeks). First armed pass: Monday Jul 20 19:00 UTC — expect
  cuts at Tamarind + Putrajaya (Jul 5 changes will be 15d old), SA deferred to
  the following week, plus ~Putrajaya-only exclusions. 387 tests + tsc green.

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
