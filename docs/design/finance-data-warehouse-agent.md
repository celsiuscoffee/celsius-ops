# Finance data-warehouse agent — design

2026-07-16. Companion to `.claude/skills/finance-warehouse/SKILL.md` (the
executable runbook — that file is the source of truth for procedure; this doc
records the why, the verified data inventory, and the goals the owner can set).

Scope of this first version: **finance data only**. The same custodian pattern
extends later to ops/HR/marketing domains one at a time.

## Problem

"Single source of truth" for Celsius finance currently exists only as tribal
knowledge encoded in two hand-maintained places: the cached prompt block
`apps/backoffice/src/lib/ops-intake/data-map.ts` and dated entries in
`docs/STATE.md`. The underlying reality is genuinely multi-source:

- Sales truth is a VIEW (`unified_sales`) over four raw tables, with a
  per-outlet cutover and a consignment outlet that settles weeks late.
- Cash truth is `BankStatement`/`BankStatementLine` while an identically-named
  and *more obvious* table (`fin_bank_transactions`) sits empty — a trap that
  has already burned queries. Same for `fin_invoices`/`fin_bills` vs the live
  `Invoice` table.
- Revenue has TWO correct lenses (till-rung vs banked GL) that differ ~20-40%
  in any month and nobody reconciles the bridge between them on a schedule.
- The finance module's own audit/eval dataset (`fin_agent_decisions`) is
  documented as "every agent call writes a row" — verification below shows it
  is effectively empty.

Nothing *owns* freshness, reconciliation, trap prevention, or drift between
the data map and the schema. Every consumer (owner questions, finance agents,
month-end close, the ops-intake assistant) silently degrades when any of those
slip. The warehouse agent is that owner.

## Shape: a custodian, not a second database

Explicitly rejected: standing up a physical warehouse (BigQuery/dbt/ETL). At
Celsius scale (4 outlets, largest table ~70k rows) Postgres answers every
query interactively, and a copied store would *create* a second source of
truth — the exact failure the owner wants to end. The warehouse is therefore
**virtual**: the production Supabase project (`kqdc…`) plus three artefacts
the agent maintains:

1. **The data contract** — the canonical-source registry in the skill file:
   for each finance question class, the ONE authoritative source, its
   freshness SLO, and its known traps. `data-map.ts` is the runtime
   projection of this contract and must never drift from it.
2. **The check suite** — a growing set of read-only SQL checks (freshness,
   dead-table guards, lens bridge, integrity) run every session. New incident
   → new check, permanently.
3. **The findings loop** — discrepancies become draft PRs
   (branch prefix `claude/finwh-`) and/or owner digest items; cleanups to
   money records are always propose-only.

Mechanically this is the proven `sentry-triage`/`housekeeping` shape: a skill
(runbook + lessons) executed by a fresh session per run, state kept in
GitHub + the agent substrate (`agent_registry` key `finance_warehouse`,
findings logged to `agent_actions`). Migration
`supabase/migrations/083_agent_registry_finance_warehouse.sql` seeds the
registry row in `shadow` mode — **not applied yet; human applies it** per
hard rule 6.

## Verified data inventory (all SQL-verified against prod, 2026-07-16)

### Canonical sources — healthy

| Question class | Canonical source | Verified state (2026-07-16) |
| --- | --- | --- |
| Till-rung sales | `unified_sales` VIEW (only sales truth) | pos_native 9,324 rows → **Jul 16**; storehub 67,396 → Jun 17 (closed history); hubbo 70,306 → Jan 20 (closed); consignment 2,249 → **Jul 12** (Nilai settles late — fresher than STATE.md's Jun 28 note) |
| Product-level sales | `unified_sale_items` VIEW | same feed |
| Cash position | `BankStatement` (Bukku Maybank feed, 6h) | 3 company accounts, all → **Jul 15** — complete set per owner |
| Cash flows / run-rate | `BankStatementLine` | 56,429 rows → Jul 15; **0 uncategorised**; classifiedBy: rule 55,119 / ap-match 1,134 / user 169 / manual 7 |
| Banked revenue (GL lens) | `fin_journal_lines` × `fin_accounts` (income) × posted `fin_transactions` | 4,621 posted txns, 10,446 lines, ΣDR RM8.32M; COA 116 active accounts |
| Supplier payables (AP) | `Invoice` (PascalCase — the LIVE one) | unpaid: 72 PENDING RM45,060.42 + 16 INITIATED RM7,780.36 + 9 DEPOSIT_PAID RM20,988.00 (full amounts, not balances) |
| Payroll cost | `fin_payroll_actuals` | 31 rows, June 2026 booked: RM77,259.50 (salary+employer stat). `hr_payroll_runs` stay sparse/draft — never use for cost |
| Committed spend | `Order` where orderType='PURCHASE_ORDER', pre-COMPLETED statuses | live (procurement loop) |

Trap tables re-confirmed empty and must stay so: `fin_bank_transactions`,
`fin_invoices`, `fin_bills`, `fin_matches` — all 0 rows. `SalesTransaction`
is a dead sync still holding 21,880 stale rows.

### Findings — the agent's initial backlog

- **F1 (high-leverage): the finance eval dataset is not accumulating.**
  `fin_agent_decisions` holds **7 rows total, all agent='purchasing-manager'**
  (latest Jul 16). The spec and the finance-module skill both state every
  categorizer/AP/AR call writes a decision row and inbox corrections update it
  — that training signal effectively does not exist in prod.
  **Root cause (code-verified 2026-07-16):** the only `categorize()` caller is
  `ingestSupplierDoc` (`lib/finance/agents/ap.ts`), whose sole entry point is
  the manual `/api/finance/bills/upload` route — and `fin_documents`/
  `fin_bills` are empty, i.e. that pipeline has never been used. The LIVE AP
  flow is procurement invoice-capture (WhatsApp/Telegram → `Invoice`), which
  never calls the categorizer; and the live gray-zone decision-maker, the
  ap-match LLM verifier, logged nothing. Two silent-failure bugs compounded
  it: `logDecision()`/`markDecisionApplied()` ignored the supabase-js error
  return.
  **Fixed in this PR:** error-swallowing removed; `ap-verifier` now logs
  every verdict to `fin_agent_decisions` (agent='ap-verifier',
  related_id=bank line, `applied=true` when the EOM apply commits it).
  **Remaining:** log the invoice-capture doc-extraction decisions and wire
  draft-invoice human edits to `recordCorrection` — needs a design pass on
  what "correction" means for extraction (field-level vs whole-parse).
- **F2: no period has ever been closed.** All 19 `fin_periods` rows
  (2025-01 → 2026-07, per company) are `open`. The close agent /
  `fin_period_locks` invariant is inert; the books are permanently re-writable.
- **F3: 88 draft `fin_transactions`** linger (latest Jun 30) — unposted
  work nobody is chasing.
- **F4: description contamination.** The 37 legitimately future-dated posted
  transactions (Jul 31 depreciation + Jan–Jul catch-up) carry bank-narration
  fragments in `description` ("… TRANSFER FR A/C AMMAR B…"), which will
  poison any LLM/text search over the ledger.
- **F5: dead-table debris.** The four empty `fin_*` twins and the 21,880-row
  `SalesTransaction` corpse invite wrong queries. Candidates for drop /
  tombstone via the housekeeping propose-only path (`prevent_drop_critical_tables()`
  applies).
- **F6: the two-lens bridge is informal.** July MTD: till lens
  RM133,241.75 vs GL income RM163,976.74 (+RM30,735, ~23%). Known components
  (Grab delivery only in GL; SST-inclusive; settlement lag; consignment
  timing) have never been quantified into a named bridge, so nobody can say
  whether a residual is benign.
- **F7: ~113 historical wrong-invoice bank matches** (STATE.md 2026-07-10)
  still await a finance-approved re-pointing pass; 6 corrected 2026-07-14.

## Goals the owner can set (pick and prioritise)

Each is measurable and maps to checks the agent runs; suggested targets in
brackets.

1. **Freshness SLOs stay green.** pos_native ≤ 1 day; bank feed ≤ 12 h;
   consignment ≤ 35 days; payroll actuals booked by day 15 for the prior
   month; GL posting lag ≤ 2 days behind bank lines. Breach → owner digest
   within one run. [Target: 0 unreported breaches]
2. **A formal monthly lens bridge.** Reconcile till-rung ↔ GL income with
   every ringgit assigned to a named bridge item (Grab delivery, SST,
   settlement lag, consignment timing, refunds). [Target: unexplained
   residual ≤ RM500 or 0.5%, whichever larger, each month]
3. **Data-contract coverage & zero drift.** Every finance question class has
   exactly one declared canonical source; `data-map.ts` updated within one
   run of any semantic/schema change (agent diffs new migrations against the
   contract). [Target: drift detected ≤ 7 days]
4. **Zero trap reads.** Dead tables stay at 0 rows, get dropped (proposed via
   housekeeping), and no code path or saved query reads them. [Target: 0 new
   references; drop executed by Q3 end]
5. **Restore the eval dataset (F1).** All live finance agents write
   `fin_agent_decisions` again, `related_id` populated at decision time,
   correction attribution fixed — unblocking the replay eval loop. [Target:
   every armed finance-agent action has a decision row within 30 days of fix]
6. **Payables integrity.** Re-point the ~113 wrong-invoice matches
   (finance-approved batch), then 0 unexplained paid-invoice ↔ bank-line
   mismatches ongoing. [Target: backlog cleared; steady-state 0]
7. **Month-end close actually happens (F2).** Day-1 "close pack": all
   sources complete + reconciled + exceptions empty, handed to the human
   approver. [Target: 2026-07 becomes the first closed period; every month
   closed by day 5 thereafter]
8. **Auditor-grade reproducibility.** Any month's P&L/BS/CF reproducible
   from canonical sources within RM1 (the Bukku-parity bar, kept as an
   internal invariant after decommission).

Recommended starting set: **1, 2, 5, 7** — freshness and the bridge make the
truth trustworthy; the eval dataset and close make it compound.

## Cadence & autonomy

- **Weekly deep run** (Sun night MYT, before the Monday digests) + a
  **day-1 close-pack run**. First runs on demand; schedule only after run 1
  proves useful (housekeeping precedent).
- **Autonomy:** read-only against prod by default. Writes it may do
  autonomously: docs, `data-map.ts`, the skill's check suite, draft PRs,
  `agent_actions` telemetry. Propose-only: any migration, any mutation of
  money records (invoices, bank lines, journals), any drop. Human-only:
  applying migrations, payroll/payments corrections (hard rule 6).

## Expansion to the whole data estate (2026-07-18)

Owner directive: "this agent should be accountable for all the data." The
custodian's mandate now covers every domain; the skill carries an estate
contract table + checks 13–20. Baseline sweep (all SQL-verified 2026-07-18):

**Healthy:** attendance → Jul 18; published rosters → week of Jul 13;
receiving/stock/wastage → Jul 17–18; checklists flowing (404 last 7d);
WhatsApp → Jul 18; redemptions → Jul 18 (23.0k members); review snapshots
nightly → Jul 17; 3 enabled ad campaigns; payroll runs now 6× paid.

**Estate findings (initial backlog E1–E7):**
- **E1** 935 open `OpsAlert` rows — the alert ledger is a swamp; needs a
  sweep/aging policy before "open alert" means anything.
- **E2** 107 POs `AWAITING_DELIVERY` (+4 `SENT` stuck since Jul 8, 1 `DRAFT`
  Jun 28) — age the open-PO book every run; propose closures.
- **E3** `sms_logs` last row **Jun 21** while the SMS lifecycle/round-gap
  loops are ARMED — either the SMS channel died quietly ~4 weeks ago or
  sends moved to push without the map knowing. Highest-priority estate
  check.
- **E4** `campaign_outcomes` has **0 rows** — the substrate's outcome memory
  has no writers yet (known gap since 080/081; loops must wire in).
- **E5** Geogrid scans stalled — last `GeoGridScan` Jul 6 (weekly cadence
  expected after the Jul 6 catchment-scale baseline).
- **E6** Substrate telemetry adoption: only **4 of 30** registered agents
  have ever written `agent_actions`.
- **E7** `StockCount` rot: 2 SUBMITTED stuck since Apr 30; 5 DRAFTs.
- Standing critical carried into the contract: loyalty tables' RLS is
  `USING(true)` (member PII anon-readable AND writable).

**Suggested estate goals (same style as the finance goals):**
1. Every domain green on its freshness SLO each weekly run (checks 13–20).
2. Open-work hygiene: open POs, stuck stock counts, and open OpsAlerts
   trend DOWN monotonically from baseline (107 / 7 / 935) with an agreed
   aging policy.
3. Comms truth: SMS channel status resolved (fixed or formally retired in
   the data map); every armed sending loop has a verifiable send log.
4. Substrate compounding: campaign_outcomes receiving writes from every
   armed marketing loop; agent_actions coverage rising toward 100% of
   armed agents.
5. Loyalty PII: RLS policy fix applied (docs/proposals — human).

## Compounding contract

- Every incident/finding becomes a permanent check in the skill's check
  suite — the suite only grows.
- Every semantic discovery lands in `data-map.ts` (runtime) and the contract
  table (skill), so the ops-intake assistant and every future session inherit
  it for free.
- Every run writes `agent_actions` rows (kind: `verification`, `finding`,
  `proposal`) under `finance_warehouse`, so the /agents panel shows health
  and the owner can audit what the custodian did.
- Corrections the owner makes to the agent's findings go into the skill's
  Lessons section, dated.
