---
name: finance-warehouse
description: Data-warehouse custodian for the WHOLE Celsius data estate (mandate expanded 2026-07-18; finance remains the deepest domain). Verify freshness/integrity of every canonical source across finance, HR, procurement/inventory, ops, marketing/loyalty, reviews/ads, comms and the agent substrate; reconcile the revenue lenses; catch data-map drift; file cleanup proposals. Use for the scheduled warehouse runs, when asked whether any business data is right/fresh/complete, before month-end close, or when any source changes semantics.
---

# Data warehouse — custodian runbook

Mandate: the single source of truth for ALL Celsius data (owner directive
2026-07-18: "this agent should be accountable for all the data"). Finance is
the founding, deepest domain; the estate contracts below extend the same
method — one canonical source per question, freshness SLOs, growing checks,
propose-only cleanups. (Skill file keeps its historical `finance-warehouse`
path/name so the scheduled routines' prompts stay valid; rename is cosmetic
housekeeping for later.)

Design + rationale: `docs/design/finance-data-warehouse-agent.md`. This file
is the source of truth for procedure. Registry key: `finance_warehouse`
(agent substrate, migration 083 — shadow until the owner arms it).

The warehouse is **virtual**: prod Supabase (`kqdcdhpnyuwrxqhbuyfl`) is the
only store. This agent maintains the *contract* over it (below), runs the
check suite, and files findings. It creates no second copy of any data.

## Autonomy ladder (owner directive 2026-07-18: "do this by itself")

The custodian does not wait to be prompted per fix. Each run WORKS the
backlog, not just reports it. What it may do at each rung — codified from
the owner-approved precedents of 2026-07-17/18:

**Rung 1 — fully autonomous (do it, record it):**
- Read-only analysis/verification; docs, data-map, skill, STATE updates.
- Code fixes with tests+typecheck shipped as draft PRs (W1 precedent:
  dead-source re-points, telemetry wiring, server-side input defaults).
- Additive derivations applied to prod: views, override tables, RLS-enabled
  server-only tables (085/086/087 precedent). Never destructive DDL.
- agent_actions telemetry; registry heartbeats.

**Rung 2 — autonomous under a pre-approved pattern (apply + audit stamp):**
- Tier-1-pattern bank-line re-points (narration names a different invoice
  AND exact amount match) — pattern approved by the owner 2026-07-17;
  future identical cases apply directly, audit-stamped, counts reported.
- Unambiguous backfills (single-candidate joins, e.g. one-package
  products) with row counts logged.
- The June mixed-regime GL correction — owner delegated 2026-07-17,
  **EXECUTED 2026-07-18, gate passed** (residuals SA −97.90 / Con −52.40 /
  Tam −58.40, all < RM500). What it actually was (NOT bank-fed): pre-cutover
  pos_native "EOD Sales" journals were MIRRORS of StoreHub rings (23 posted
  duplicates reversed, pairs net zero, RM79.6k); Conezion's EOD poster was
  BROKEN Jun 8–17 and SA partial Jun 15–17 (13 identity-derived top-ups,
  +RM47.0k; tender mapping card=tender'card', grab=channel'grabfood',
  cashqr=rest — verified to the sen on Jun-20); StoreHub journals included
  cancelled Online-method payments (21 adjustments, −RM3.4k); Tam Jun-30
  EOD was stuck in draft (posted). June till-income: Con 123,380.24 /
  SA 105,371.05 / Tam 79,590.37. LATENT BUG found while applying:
  ledger.ts reverseTransaction marks originals status='reversed' AND posts
  a negative reversal — posted-only reports would subtract TWICE (0
  historical pairs, never fired; fix = keep original posted, key off
  reversed_by_id; backlogged).

**Rung 3 — propose-only (draft PR / doc, never executed):**
- Any money-record mutation outside a pre-approved pattern; destructive
  DDL/table drops; product-visible behaviour changes; threshold changes.

**Rung 4 — human-only, always:** payroll/payments actions, arming any
agent (incl. consumption engine), closing/reopening periods, merging PRs.

Escalation: things needing a human land in the PR body under "Human
actions" + STATE; genuinely urgent findings (money misstatement, channel
dead) also go to agent_actions with kind='escalation'. Silent runs are
normal when everything is green and the backlog is empty.

## Guardrails

- **Read-only against prod by default.** Allowed writes without asking:
  docs, `apps/backoffice/src/lib/ops-intake/data-map.ts`, this skill, draft
  PRs (branch prefix `claude/finwh-`), `agent_actions` telemetry.
- **Propose-only** (draft PR or SQL shown in chat, never executed): any
  migration, any DROP, any mutation of money records (Invoice,
  BankStatementLine, fin_* business tables). **Human-only:** applying
  migrations, anything payroll/payments (CLAUDE.md hard rule 6).
- ≤ 3 cleanup proposals per run; re-proposing next run is cheap.
- Never "fix" a lens difference by changing a source — the two lenses are
  BOTH correct (different meanings). Only the bridge explains them.
- The `db-migration` skill governs any schema change this agent proposes.

## The data contract (canonical sources + SLOs)

One authoritative source per question class. If a question doesn't fit a
row, that's a finding — extend the contract, never freelance a source.
Full semantics + traps: `data-map.ts` (keep the two in lockstep).

| Question class | Canonical source | Freshness SLO |
| --- | --- | --- |
| Sales / product mix | `unified_sales` VIEW (since 2026-07-17 includes pickup — pos + grabfood + pickup + consignment; never add `orders` on top) / `unified_sale_items` (no pickup lines yet) | pos_native+pickup ≤ 1d; consignment ≤ 35d; storehub/hubbo frozen history |
| Banked revenue (GL lens) | posted `fin_transactions` + `fin_journal_lines` × `fin_accounts` income | posting lag ≤ 2d behind bank lines |
| Cash position | `BankStatement` latest closingBalance per account (3 accounts = complete) | ≤ 12h behind feed |
| Cash flows / run-rates | `BankStatementLine` (exclude isInterCo) | ≤ 12h; 0 uncategorised |
| Supplier payables | `Invoice` (PascalCase) — amount is FULL even when PARTIALLY_PAID | live |
| Committed spend | `Order` orderType='PURCHASE_ORDER', pre-COMPLETED | live |
| Payroll cost | `fin_payroll_actuals` (never hr_payroll_runs) | prior month booked by day 15 |
| Wastage | `StockAdjustment.costAmount` | live |
| PT wages | `BankStatementLine` partimer rule → GL 6500-03 (never payroll runs) | weekly |

**Dead tables — must stay 0 rows, never query:** `fin_bank_transactions`,
`fin_invoices`, `fin_bills`, `fin_matches`, plus stale `SalesTransaction`
(21,880 frozen rows, ended 2026-04-11).

## Estate domain contracts (baseline verified 2026-07-18)

Same rules as finance: one canonical source per question class; if a
question doesn't fit, extend the contract. `data-map.ts` stays the runtime
projection for sales/cash/payroll semantics.

| Domain | Canonical sources | SLO / conventions | Standing traps & watch items |
| --- | --- | --- | --- |
| HR / people | Roster: `hr_schedules` (published only) + `hr_schedule_shifts`. Attendance: `hr_attendance_logs` (adoption erratic — absence ≠ absent). Profiles: `hr_employee_profiles` (76) vs `User` ACTIVE (56; profiles include resigned). Payroll COST stays `fin_payroll_actuals` | next week published by Sun night; attendance same-day | `hr_payroll_runs` now has 6 paid runs (2026-07-18) but remains NON-canonical for cost. `hr_staff_weekly_availability` = 0 rows until PT-loop UI ships (round 6) |
| Procurement / inventory | POs: `Order` orderType='PURCHASE_ORDER'. Receipts: `Receiving`. Stock: `StockBalance` (shadow — consumption engine off; reorder runs off receipts−wastage). Wastage: `StockAdjustment`. Pars: `ParLevel` (weekly recalc). Counts: `StockCount` (+coverage guard) | receiving ≤ 1d; pars recalced weekly Sun | Open-PO rot: 107 AWAITING_DELIVERY at baseline — age them every run. Counts stuck SUBMITTED (2 since Apr 30). Stock accuracy is SHADOW until unit normalisation + recipes |
| Ops | `Checklist` (assignment semantics!), `OpsAlert` (ledger, RESOLVED can be bulk claim), `SystemReport`, `AuditReport` | checklists same-day | **935 open OpsAlerts at baseline** — the ledger is a swamp; track the number, propose a sweep policy |
| Marketing / loyalty | Members: `member_brands` (23.0k). Redemptions: `redemptions`. **Loop sends: `loop_assignments`** (channel sms/push + sms_status — the lifecycle loops' ledger; provider SMSNiaga via app_settings.sms_provider since 2026-06-21). Legacy: `sms_logs` (campaigns-auto/tests only, quiet = normal) + `sms_credits` (SMS123-era). Outcomes: `campaign_outcomes` (substrate) | redemptions live; loop sends daily | RESOLVED 2026-07-18: the "SMS dead since Jun 21" red was a wrong-canonical-source error — loops send 100–200/day via SMSNiaga. Real residuals: RESOLVED 2026-07-18 — `campaign_outcomes` wired (measureRound writes it; 130 rounds backfilled; see check 18). Loyalty RLS `USING(true)` (PII anon-writable — standing critical) |
| Reviews / GBP / ads | `ReviewDailySnapshot` (nightly), `GeoGridScan`+`GeoRankSnapshot` (catchment-scale only), `ReviewReplyDraft`, `ads_campaign` (status enum is TEXT numbers — '2'=ENABLED), `ads_budget_change`, `grab_ads_spend` | snapshot daily; geogrid weekly | Geogrid stall root-caused + fixed 2026-07-18 (failed scans ate the monthly budget — see check 19). Trust only complete catchment-scale scans |
| Comms | `WhatsAppMessage` (direction/type; template ≈ RM0.07) | live | — |
| Agent substrate | `agent_registry` (30 agents), `agent_actions` | every armed agent logs actions | Only 4/30 agents write agent_actions at baseline — telemetry adoption gap; nudge per-domain wiring |

**Estate checks (13+ — same growth rule as the finance suite):**
13. Roster-published SLO: max published week_start ≥ next Monday by Sun 22:00 MYT.
14. Open-PO age: AWAITING_DELIVERY/SENT older than 14d — count + oldest; [growth vs baseline 107].
15. StockCount rot: SUBMITTED > 7d or DRAFT > 7d. [any]
16. OpsAlert swamp: open count [growth vs 935 baseline].
17. SMS pulse: **canonical source is `loop_assignments`** (channel='sms',
    sms_status by day — the lifecycle loops' send ledger), NOT `sms_logs`
    (legacy: campaigns-auto + tests only; quiet since the 2026-06-21
    SMSNiaga switch and that is CORRECT — both legacy campaigns inactive).
    Healthy = sms/sent rows daily (~100–200/day baseline) with near-zero
    failed. [failures spiking or zero sent-rows for 3+ days while loops
    armed = channel problem]
18. campaign_outcomes writers: WIRED 2026-07-18 — measureRound writes one
    row per measured round (campaign_key '<loop>-r<no>', uplift_pct in pp,
    evidence-gated verdict; 130 rounds backfilled). Healthy = new rows
    within ~2d of any measured round; [rounds measured after 2026-07-18
    with no matching campaign_outcomes row = the write broke — it is
    try/caught in measureRound so it fails SILENTLY except for a console
    error].
19. Snapshot cadence: ReviewDailySnapshot within 2d; GeoGridScan within 10d.
    [Geogrid stall root-caused 2026-07-18: failed scans used to eat the
    40/mo budget (quota storm Jul-6 burned it in one run). Fixed: budget +
    cadence exclude status='failed', scanGrid paces ~8 req/s with retries,
    cron has per-run cap 15 + outage circuit breaker. Expect scans to
    resume Mon Jul-20 after deploy; still none by Jul-22 = new problem.]
20. Substrate telemetry: distinct agent_key in agent_actions ÷ armed agents in registry [ratio should rise; baseline 4/30].
21. Package coverage: % ReceivingItem with productPackageId [70% after the
    2026-07-18 single-package backfill (was 29%); target ≥90%; ratchet —
    never regress].
22. Recipe drift: menus without MenuIngredient rows [baseline 0/92; any
    new menu without a BOM] + consumption cron summary itemsUnmapped
    [~4%/outlet baseline; growth = catalog drift].
23. Cost coverage: recipe ingredients with a usable product_costs row
    [baseline 104/138 = 75% at W3 ship; rises with check 21; any
    menu_margins row with uncosted_ingredients>0 is overstated — say so
    when quoting margins].
24. Consumption source: no `prisma.salesTransaction` reads in live code
    [fixed in cogs-activation W1 (PR #970); guard against regression].
25. Valuation anchors: `fin_inventory_valuations` has an anchor per active
    till outlet for the current COGS boundary [EMPTY at baseline —
    accountant owes the Bukku close values, see
    docs/proposals/inventory-valuation-anchors.md; sanity gate 0.3×–2× of
    trailing-30d purchases before insert].
26. Payroll bridge (monthly): fin_payroll_actuals (gross+employer, accrual,
    from BrioHR) vs GL cash lens (6500-02 net-paid + STATUTORY_PAYMENT
    bank lines + 6500-03 PT). Known-good anchors 2026-06: actuals 77,261 /
    run net 59,682 / GL 6500-02 64,128 / statutory 31,992 / PT 24,403.
    [unexplained monthly gap > RM5k → decompose the 6500-02 lines. Exclude
    the 'opening_balance' BrioHR-import run (draft, RM400,729 gross) from
    ALL run aggregations — it is a stub, not a payment]
27. Payroll-run hygiene: runs table has no delete audit — count runs each
    check; a decreasing count = someone deleted a run (observed 8→7 on
    2026-07-18, an aborted ai_computed run). [flag deletes; propose an
    audit table if it recurs]
28. PT wage bridge (monthly, owner-directed 2026-07-18): computed =
    published rostered hours (net of breaks) × `hourly_rate` (or shifts ×
    `shift_flat_rate`) for `employment_type~part` profiles, vs paid =
    partimer bank lines. **Baseline June: computed 18,187 vs paid 24,403
    (+34%)**; attendance corroborates roster (July: 872 attended vs 867
    rostered hrs — PT clock-in is good). Known gap components: Nilai
    (~1.4k/mo, consignment, no roster), unrostered covers/swaps, PTs
    missing profiles/rates, stale rates. [alarm if gap > 40% or trending
    up. Person-level reconciliation is BLOCKED on missing data: payments
    are outlet-level lump transfers — per-person weekly PT breakdown is a
    needs-register gap the managers' sheet must fill]
    Statutory note (check 26 addendum, RESOLVED 2026-07-18): ALWAYS
    exclude `isInterCo` lines — own-entity "Stat Pay" reimbursements were
    misflagged false on BOTH legs (4 CR + 4 DR lines, corrected). The
    residual is fully decomposed; the statutory payment map is:
    - All statutory pays from central CELSIUS COFFEE SDN BHD (4384):
      one EPF employer (023733927), one PERKESO code (B3902109148A) —
      Conezion/Tamarind reimburse via the interco "Stat Pay" transfers.
    - **PCB is NOT under STATUTORY_PAYMENT** — it lives in category TAX
      as "LHDN - SEMENANJUNG 9609021908" M2UBIZ lines, and matches
      prior-month `pcb_tax` due EXACTLY (Jun-15 1,054.15 = May due;
      May-15 1,570.00 = Apr due). The recurring RM300/mo
      "LHDN SEMENANJUNG 1125095480911xxx" lines are CP204 company-tax
      installments — NOT payroll; never count them in the bridge.
    - EPF pays lag-1 within ~RM1k (recurring +936 delta ≈ Poket Capital
      shared staff, reimbursed ~RM540/mo "Shared statpay" — entity
      outside fin_companies, owner confirmation pending).
    - SOCSO+EIS pays lag-1 mid-month, ~1,590–1,650/mo (PERKESO + SIP
      lines). Late precedent: April's PERKESO leg paid May-7.
    - WATCH (open): June SOCSO due 2,164.25 (+43% vs May) but only
      156.60 paid by Jul-15 deadline — if no catch-up PERKESO payment by
      end-July, escalate (late-payment interest risk).
29. PO aging ratchet: open AWAITING_DELIVERY POs >14d [50 at baseline
    2026-07-18, RM35.6k — ALL zombies (0 receivings; 44/50 superseded by
    newer completed POs from the same supplier). Cancel-list proposal:
    docs/proposals/po-aging-sweep.md (rung 3, owner approves). After the
    sweep this should trend to ~0; a rebound = the receiving flow is
    skipping PO linkage again (same family as the packageId bug)].
30. OpsAlert hygiene: open (OPEN/ACKED/ESCALATED) alert count [954 → 172
    after the 2026-07-18 EXPIRED sweep. Auto-expiry now runs in the
    ops-pulse cron (ledger.expireStaleAlerts): day-bound signals
    (CHECKLIST/NO_CLOCK_IN/POS_NOT_OPEN/STOCK_COUNT/RUNAWAY) expire >3d,
    MENU_SNOOZED >14d. Expiring never re-pages (dedupeKey rows persist).
    Open count creeping past ~300 = expiry broke or a new signal needs
    classifying as day-bound vs state-bound].
31. Warehouse coverage (owner-directed 2026-07-24, "make sure all data is
    in the warehouse"): enumerate prod tables by live rows (query in
    docs/design/warehouse-coverage-register.md), diff material tables
    (≥50 rows) against those named in data-map.ts + this skill. Every
    material table must carry a verdict in the register. [A NEW material
    table with no verdict = an unclassified source — investigate and
    classify it (canonical / covered-via-parent / derived-cache / gap).
    Re-run each month-end. Baseline gaps closed 2026-07-24: Grab
    commission (6519 via grab_clearing), grab_ads_spend, Google Ads
    ads_* subsystem, consignment_sales, fin_documents, fin_fixed_assets,
    RecurringExpense — all now in the data-map. 12 debris tables
    (*_backup_/_quarantine_/_deleted_) flagged for housekeeping cleanup.]
- unified_sale_items now includes the pickup branch (migration 088,
  applied 2026-07-18): order counts reconcile 1:1 with unified_sales;
  line_total is PRE-discount (sums ~4% above nett — same semantic as all
  branches).

## Run procedure

1. Read `docs/STATE.md` + this skill. `touchAgentRun('finance_warehouse')`
   semantics: log a run-start row to `agent_actions` via SQL only if the
   registry row exists (migration 083 may not be applied yet — skip
   silently if absent).
2. **Run the check suite** (below) read-only via Supabase MCP. Compare
   against SLOs and the previous run's baseline (design doc table = first
   baseline, 2026-07-16).
3. **Drift scan:** list migrations added since last run
   (`supabase/migrations/`, `apps/backoffice/supabase/migrations/`,
   `packages/db/prisma/migrations/`) and diff against the contract +
   `data-map.ts`. Any table/column/semantic change touching a contract row →
   update both in the same PR.
4. **File findings:** open ONE draft PR `claude/finwh-<date>` containing
   doc/contract/data-map updates + a findings section; anything needing
   owner action goes in the PR body under "Human actions". Log each finding
   to `agent_actions` (kind `finding`) when the registry exists.
4b. **BUILD (the self-driving part):** pick the top 1–3 backlog items
   (failing checks first, then the backlog sections below, then
   cogs-activation workstreams) and fix them END-TO-END within the
   autonomy ladder — code + tests + typecheck in the same draft PR, or
   rung-1/2 prod applies with audit trail. Do not stop at describing the
   fix. An item blocked above rung 2 gets its proposal written and its
   blocker named, then move to the next item. Record what was
   built/applied in STATE and agent_actions so the next run continues
   instead of rediscovering.
5. **Close pack** (day-1 runs only): assemble per company — sources complete
   through month end (checks 1–4 green for the closed month), lens bridge
   for the month, open drafts/exceptions count, unpaid AP snapshot — and
   hand to the human approver. Never close a period yourself.
   **COGS trust gates (input-quality enforcement — the custodian is
   accountable for humans' inputs being usable):** the pack marks actual
   COGS as NOT TRUSTWORTHY, with named blockers and owners, when any of:
   (a) an active outlet lacks a REVIEWED monthly StockCount (≥85%
   coverage) for the closed month; (b) no `fin_inventory_valuations`
   anchor chain covers the COGS boundary (accountant pack:
   `docs/proposals/inventory-valuation-anchors.md`); (c) package coverage
   (check 21) regressed during the month; (d) counts stuck
   SUBMITTED/DRAFT >7d exist. Recipe-vs-actual variance (W5) is only
   reported for months whose gates pass — never compare against untrusted
   actuals.
6. Update STATE.md (resume pointer + new verified facts) inside the PR.

## Check suite (v1 — grows monotonically; add, never remove)

Run each as read-only SQL. Failure conditions in brackets.

1. **Freshness:** max(biz_date) per `unified_sales` source; max(statementDate)
   per BankStatement account; max(txnDate) BankStatementLine; max(period)
   fin_payroll_actuals. [any SLO breach]
2. **Dead-table guard:** counts of the 4 fin_* twins. [any > 0 — something
   started writing a trap table]
3. **Trap-read guard:** grep the repo for `fin_bank_transactions|fin_invoices|
   fin_bills|fin_matches|"SalesTransaction"` outside docs/migrations/this
   skill/data-map traps. [new code reference]
4. **Uncategorised bank lines:** count where category is null. [> 0]
5. **Lens bridge (MTD + prior month):** till lens (unified_sales nett,
   excl refunds/cancelled) vs GL income (posted, income/revenue accounts).
   Decompose the gap: Grabfood (5000-04) + GastroHub (5000-09) + other
   GL-only channels (e.g. 5000-10 events), then card settlement lag.
   Do NOT use unified_sales.sst — that column is dead (all-zero).
   [unexplained residual > max(RM500, 0.5%)]
6. **Ledger integrity:** posted transactions where Σdebit ≠ Σcredit (trigger
   should make this impossible — [any row] means trigger bypassed);
   journal lines referencing inactive/missing COA codes.
7. **Draft rot:** fin_transactions status='draft' older than 14 days. [count
   grows vs baseline 88]
8. **Future-dated posts:** posted txn_date > today, excluding month-end
   depreciation convention (day = last of current month, description like
   'Depreciation%'). [any other]
9. **Eval-dataset pulse (F1):** fin_agent_decisions row count by agent vs
   last run. [no growth while AP/EOD/ap-match crons ran = logging still
   broken]
10. **Period hygiene (F2):** fin_periods older than 2 months still open.
    [flag until the close loop is live]
11. **AP ↔ bank integrity:** invoices PAID with no linked bank line;
    bank lines whose narration quotes an invoice number ≠ the linked
    invoice's number (the wrong-invoice class). [any new since baseline]
12. **Duplicate-source guard:** sum(pos_orders nett) + sum(storehub nett) +
    consignment vs sum(unified_sales nett) for a sample month — the view
    must equal its parts exactly (cutover exclusivity). [mismatch]

## Initial backlog (from the 2026-07-16 baseline — see design doc)

- F1 eval dataset empty — root-caused 2026-07-16: categorizer sits on the
  dormant `/api/finance/bills/upload` pipeline; live AP flow never calls it.
  ap-verifier verdict logging + silent-error fixes shipped in the founding
  PR. Remaining: log invoice-capture extraction decisions + wire draft-
  invoice edits to `recordCorrection` (needs a correction-shape design).
- F2 no period ever closed — build the close pack, get 2026-07 closed.
- F3 88 stale drafts — list for the owner, propose disposition.
- F4 depreciation descriptions contaminated with bank narrations — propose
  description hygiene fix at the writer.
- F5 drop/tombstone dead tables (via housekeeping propose-only path;
  `prevent_drop_critical_tables()` must be amended in the same migration).
- F6 formalise the lens bridge (check 5 is the vehicle).
- F7 ~113 wrong-invoice matches — prepare the finance-approved re-pointing
  batch (propose-only).

## Lessons

_Append dated entries when a run teaches something this file missed. Promote
stable ones into the sections above._

- 2026-07-16 — Baseline run: consignment settlements can land weeks after
  STATE.md notes claim (Jun 28 note vs Jul 12 actual) — always re-verify
  freshness live, never trust a dated note for it.
- 2026-07-16 — `fin_periods` has no `period_start` column (it's `period`
  text 'YYYY-MM' + `company_id`); `fin_accounts` uses `is_active`;
  `SalesTransaction` has no `transactionDate`. Check column names via
  information_schema before authoring new checks.
- 2026-07-17 (run 1) — **BankStatement freshness SLO refined:** the feed
  delivers day D's statement during D+1, so "latest = day-before-yesterday"
  in the morning is NORMAL; alarm only if day D's statement is still absent
  at end of D+1 MYT.
- 2026-07-17 (run 1) — Check 11b's canonical query (non-manual linked lines
  whose description contains a different invoice's number ≥5 chars and not
  the linked one's) counts **133** — the precise size of the "~113"
  wrong-invoice backlog. Bank-line link columns: `apInvoiceId`/`apMatchedAt`/
  `glTransactionId`. Also: `paidVia='bank-ap-match'` with no linked line is
  an inconsistent state worth listing every run.
- 2026-07-17 (run 1) — `unified_sales.sst` is dead (all-zero across all
  sources/time). The June bridge decomposes as Grabfood + GastroHub + ~5%
  residual ≈ card settlement lag (SST is NOT a bridge item — nett is
  as-rung). Quantifying settlement lag needs per-day card tender vs
  5000-02 postings.
- 2026-07-17 (run 1) — In batched check SQL, parenthesise every UNION
  branch that uses GROUP BY/HAVING/LIMIT, and cast Invoice amounts
  (`round(amount,2)`) — raw numerics print with 30 decimal places.
- 2026-07-17 (run 2) — **The GL income lens changed semantics at the POS
  cutover**: 5000-01/02/04 are EOD-journal-fed (accrual at ring-up) since
  ~Jun 6–18, bank-fed before. Verified Jul 1–14: EOD income = till(pos+
  grabfood) + pickup-app orders − consignment, residual RM48. Grab delivery
  payouts now post to 1005 transit. **June 2026 is mixed-regime — both fed
  income Jun 6–17; up to RM81,270.74 double-count, unwind needed while the
  period is still open.** Bridge check 5 must use the era-correct model.
- 2026-07-17 (run 2) — **unified_sales does NOT include the pickup app**
  (`orders`, ~RM40k/mo; money columns in SEN). Any "total revenue" from the
  view alone undercounts. `tender` is null for the whole StoreHub era —
  per-tender analysis valid only from the pos_native cutover; June has zero
  'cash' tender rows (coverage gap, watch).
- 2026-07-17 (run 2) — Re-pointing batch prepared (propose-only):
  `docs/proposals/finwh-repoint-133-wrong-invoice-matches.md` — tier 1 = 92
  exact-amount narration matches (RM30,470.60) with gated SQL; tier 2 = 41
  manual (RM21,251.98). After any run, re-run check 11b expecting the
  tier-2 residual only.
- 2026-07-17 (session 2, owner-approved actions) — **Tier-1 batch EXECUTED**
  (92 rows, check 11b residual now 41; the orphaned
  `paidVia='bank-ap-match'`-no-line review list grew accordingly — finance
  must disposition it). **Pickup channel ADDED to unified_sales** (migration
  085, applied; July: 1,347 rows / RM41,649.74; `unified_sale_items` still
  lacks pickup lines — follow-up). **June unwind REVISED — do NOT apply a
  blanket reversal:** day-level reconstruction shows Tamarind double
  Jun 6–17 and SdnBhd Jun 6–14 (EOD posted full StoreHub days while
  bank-fed income ran), but Conezion Jun 8–17 and SdnBhd Jun 15–17 are
  UNDER-counted (EOD posted only pickup ~RM400/day while the new till rang
  ~RM3k/day and settlements went to 1005). Net June error is a mix of
  over/under; the correcting entries must be per company-day: reverse
  bank-fed income for sales-days covered by a full EOD, ADD income for
  pos-era days EOD missed. This reconstruction is the weekly run's top
  backlog item.
