---
name: finance-warehouse
description: Finance data-warehouse custodian — verify freshness/integrity of every canonical finance source, reconcile the two revenue lenses, catch data-map drift, file cleanup proposals. Use for the scheduled warehouse run, when asked "is the finance data right/fresh", before month-end close (close pack), or when a finance source changes semantics.
---

# Finance warehouse — custodian runbook

Design + rationale: `docs/design/finance-data-warehouse-agent.md`. This file
is the source of truth for procedure. Registry key: `finance_warehouse`
(agent substrate, migration 083 — shadow until the owner arms it).

The warehouse is **virtual**: prod Supabase (`kqdcdhpnyuwrxqhbuyfl`) is the
only store. This agent maintains the *contract* over it (below), runs the
check suite, and files findings. It creates no second copy of any data.

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
| Till-rung sales / product mix | `unified_sales` / `unified_sale_items` VIEWs | pos_native ≤ 1d; consignment ≤ 35d; storehub/hubbo frozen history |
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
5. **Close pack** (day-1 runs only): assemble per company — sources complete
   through month end (checks 1–4 green for the closed month), lens bridge
   for the month, open drafts/exceptions count, unpaid AP snapshot — and
   hand to the human approver. Never close a period yourself.
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
   Decompose the gap: Grabfood account income, SST portion, settlement-lag
   estimate, consignment timing. [unexplained residual > max(RM500, 0.5%)]
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
