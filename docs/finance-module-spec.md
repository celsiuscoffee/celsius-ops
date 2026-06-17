# Finance Module — Spec

In-house agentic finance module that replaces Bukku. Becomes the system of record for Celsius Coffee accounting. Lives in backoffice at `/finance`.

## Why

Bukku is form-heavy and human-driven: every invoice, bill, and journal entry needs someone to type it. The new module flips the model: agents auto-categorize, auto-match, auto-post. Humans only resolve the small set of items the agents can't handle confidently.

## Boundaries

- **In scope:** AR (POS-driven), AP (supplier docs), bank reconciliation, payroll posting, fixed assets, depreciation, period close, P&L/BS/CF, SST-02 filing prep, MyInvois e-invoice submission, audit trail, auditor pack export.
- **Out of scope (handled elsewhere):** payroll calculation (HR module owns it; we just receive the journal), inventory valuation (existing inventory module owns it), corporate tax filing (external tax agent).
- **No more Bukku** after cutover. Cutover plan: dual-run for 1 full month, prove parity, then decommission.

## COA

Seeded once from Bukku export 2026-05-02 (see `apps/backoffice/supabase/migrations/003_finance_coa_seed.sql`). After seed, the module owns the COA. Codes are stable identifiers — sub-account codes like `5000-04` for Grabfood are referenced by agents directly.

## Architecture

```
SOURCES                          AGENTS           LEDGER (us)        OUTBOUND

INTERNAL (system of record)                                         ┌─→ MyInvois (LHDN)
  pos_orders / pos_order_payments  EOD aggregator                   │
  orders (online / pickup)     ─┐  Ingestor    ─→ fin_transactions ─┼─→ SST-02 (Customs)
  hr_payroll_runs (journal)    ─┼─ Matcher      + fin_journal_lines ├─→ Auditor pack
                                │  Categorizer        ↓             ├─→ WhatsApp digest
EXTERNAL (ingest-only pipes)   ─┤  AP / AR        Exception inbox   └─→ Bank payment files
  Bukku bank feed (Maybank /    │  Close          (only human
    CIMB / RHB tx via API)     ─┘  Compliance      surface)
  Card settlement report          Anomaly
  Supplier docs (email inbox)
```

We are a single-tier system. **We are the only book of record.** No external system holds Celsius accounting state after cutover.

### Infra-only principle (revised 2026-06-13)

Post-migration Celsius runs **StoreHub-free and Bukku-free as systems of record**. Two distinctions matter:

- **Internal sources are the system of record.** Sales/AR come from our own POS (`pos_orders`, `pos_order_payments`) and online (`orders`) — not StoreHub EOD. The `storehub-eod` ingester is transitional and retired once the internal EOD aggregator is live (see Build phases). Note: `pos_orders.outlet_id` holds a POS code (`outlet-sa`, etc.), not the outlet UUID — finance maps this to `Outlet` as a first-class step.
- **External data may enter; no external system of record may persist.** Bank transactions, card settlement reports, delivery-platform payouts, and supplier invoices are inherently external and flow *in* — but they post into `fin_*` only.

**Bukku is demoted from book-of-record to bank-feed pipe.** Malaysian banks expose no SME transaction API; Bukku already holds direct bank-feed connections (Maybank / CIMB / RHB) that auto-flow transactions. We pull those lines via the Bukku API (`developers.bukku.my`, Bearer token) into `fin_bank_transactions` and keep a minimal Bukku subscription alive solely as that conduit. We do **not** keep Bukku's ledger. This is swappable: if a direct bank feed or an aggregator opens up, replace the pipe without touching the rest of the module.

> ⚠️ **Open verification (blocks bank-feed ingest):** confirm on `developers.bukku.my` that the API exposes **bank-feed transaction lines for read/retrieval** — not merely statement import into Bukku's own reconciliation. The feeds exist; programmatic read-access to those lines is the make-or-break for this path.

## Data model

See migration `002_finance_module.sql`. Key tables:

| Table | Purpose |
|---|---|
| `fin_accounts` | Chart of accounts. Hierarchical via `parent_code`. |
| `fin_documents` | Every inbound source artefact (POS EOD, bank stmt, supplier PDF). |
| `fin_transactions` | One row per business event. Status: `draft → posted → reversed`. |
| `fin_journal_lines` | Double-entry lines. Sum debit = sum credit (enforced on `posted`). |
| `fin_bank_transactions` | Raw bank feed lines. |
| `fin_invoices` | AR. Mostly auto from POS. Channel-tagged. |
| `fin_bills` | AP. Created by AP agent from supplier docs. |
| `fin_matches` | Reconciliation log: bank line ↔ invoice/bill/transaction. |
| `fin_exceptions` | The only human surface. |
| `fin_agent_decisions` | Every agent call recorded for audit + retraining. |
| `fin_periods` + `fin_period_locks` | Month-end close state. |
| `fin_fixed_assets` | Drives depreciation. |
| `fin_einvoice_submissions` | MyInvois UUID + LHDN response per invoice. |
| `fin_sst_filings` | Monthly SST-02. |
| `fin_audit_log` | Append-only. Every fin_* write logged via trigger. |
| `fin_user_roles` | Finance-specific scoping (admin, ops, auditor RO). |

### Invariants enforced by triggers

1. **Posted transactions must balance.** `fin_check_balanced` blocks `status='posted'` if `sum(debit) ≠ sum(credit)`.
2. **No posting to closed periods.** `fin_check_period_open` blocks posts where `fin_periods.status = 'closed'`.
3. **Audit log on everything.** `fin_audit()` fires after insert/update/delete on every business table, capturing `actor` from `current_setting('app.actor')`.
4. **Updated-at touch.** `fin_touch_updated_at` keeps `updated_at` in sync.

### Setting the actor

Every server-side call must set the actor before mutating fin_* tables:

```sql
select set_config('app.actor', 'matcher-v1', true);  -- agents
select set_config('app.actor', :user_id, true);      -- humans
```

Falls back to `'system'` if unset, but that should never happen in production.

## Agents (8 total)

Each agent is a stateless function `(input, context) → decision`. Confidence ≥ threshold → auto-post; below → exception.

| Agent | Trigger | Threshold | Posts to |
|---|---|---|---|
| Ingestor | webhook / cron | n/a | `fin_documents` |
| Categorizer | new doc/txn | 0.85 | journal lines (proposes account_code) |
| Matcher | new bank txn / new bill or invoice | 0.90 | `fin_matches` |
| AP | parsed supplier doc | 0.85 | `fin_bills` + journal |
| AR | StoreHub EOD | 0.95 | `fin_invoices` + journal |
| Close | day 1 of month (manual approve) | n/a | period close + snapshot |
| Compliance | per invoice / monthly | manual approve | `fin_einvoice_submissions`, `fin_sst_filings` |
| Anomaly | continuous | always exception | `fin_exceptions` |

Every call writes a row to `fin_agent_decisions` regardless of whether it auto-posted. Corrections from the exception inbox update the same row with `corrected=true, corrected_to=...` — that's the training signal.

### Categorizer prompt shape

Claude receives:
- Source doc text (parsed) + metadata (vendor, amount, date)
- Last 50 categorized transactions for the same vendor / similar pattern
- Full COA (codes + names + subtypes)
- Outlet hint (from doc source or vendor history)

Returns:
```json
{
  "account_code": "6001-04",
  "outlet_id": "outlet_uuid",
  "confidence": 0.92,
  "reasoning": "FarmFresh supplier; 50/50 invoices in last 12mo posted to 6001-04 (Milks)"
}
```

Reasoning stored in `fin_agent_decisions.output`.

## Backoffice routes

Only 5:

1. `/finance` — home: **Business Feed-style** agent activity, exception banner (only when items exist), MTD revenue card, cash position per bank, recent journals.
2. `/finance/transactions` — universal ledger. Filters + detail drawer with journal lines, source doc, agent + confidence display, audit trail.
3. `/finance/inbox` — exception queue. Approve / Correct / Reject. The only action surface.
4. `/finance/reports` — P&L, BS, CF (live, on demand). Drill-down on any line. Auditor pack export. Reports library + favourites (QuickBooks pattern).
5. `/finance/compliance` — SST-02 status, e-invoice queue, period close, year-end checklist.

No invoice form. No bill form. No COA editor (settings page only for read + activate/deactivate). No manual journal entry screen (exists as an admin escape hatch via API only, with a written reason — exception inbox is the normal path for human input).

### Visual references

- **Wise web** (`mobbin.com/apps/wise-web`) — left rail nav, large transaction list, right detail drawer. Our base layout.
- **QuickBooks web** (`mobbin.com/apps/quick-books-web`) — Business Feed (agent activity recap on home), reasoning behind suggestions ("Why am I seeing these?"), reports library with favourites, inline "Categorize transactions" CTAs on reports. Stolen patterns:
  - Home is a feed, not a static dashboard
  - Every agent decision exposes its `reasoning` field on hover ("Why this code?")
  - Reports show a banner when uncategorized items exist, deep-linking to the inbox

## Build phases

**Status as of 2026-06-13:** Phases 1 + 5 done; Phase 2 done on StoreHub rails (to be repointed); Phase 3 partial (AP works from manual upload). The list below is **re-sequenced** for the infra-only, Bukku-bank-feed architecture. The current blocker order is: outlet-code mapping → internal EOD aggregator → Matcher (rules-first) → Bukku bank-feed ingest → exception resolvers (all types) → Anomaly → supplier email inbox.

1. **Foundation** — ✅ done. Schema `002` + COA seed `003` + RLS + routes.
2. **AR autopilot** — ✅ done on StoreHub EOD; ✅ **re-pointed to internal infra.** The internal EOD aggregator (`lib/finance/ingestors/internal-eod*.ts`) builds the same `EodSummary` from `pos_orders` + `pos_order_payments` + `orders`, with first-class `Outlet` UUID → POS-code/store-slug mapping, feeding the unchanged AR agent. The daily `finance-eod` cron now routes per outlet via `eodSourceFor` (`eod-router.ts`): cutover outlets → internal, pre-cutover → StoreHub, never both. Cutover is day-grained (`posNativeCutoverAt`); set it at a midnight MYT boundary so no day is split. Retire `storehub-eod` once every outlet has cut over.
3. **Bank feed + Matcher** — the cutover gate. ✅ **Matcher rules engine built** (`agents/matcher-rules.ts` pure + `agents/matcher.ts` IO + `/api/finance/match` trigger): reconciles each `fin_bank_transactions` line against open `fin_invoices` (AR) / `fin_bills` (AP) by exact reference, exact amount within a date window, and rounding tolerance; ≥0.90 auto-writes `fin_matches` + advances `payment_status`/`paid_amount`, sub-threshold → `match` exceptions with the best proposal. Sign routes AR vs AP; one-deposit-can't-match-two via in-memory outstanding decrement. ✅ **Bank-feed landing zone built** (`ingestors/bank-feed*.ts`): source-agnostic `ingestBankLines()` normalizes lines from any source into `fin_bank_transactions`, idempotent via the composite unique constraint (absent reference coerced to `""` so PG's distinct-NULLs don't defeat dedupe). **Pending:** (a) the **Bukku adapter** — fetch from the Bukku bank-feed API + map its response to `BankLineInput[]`, then call `ingestBankLines` (blocked only on a sample response / endpoint from an authenticated Bukku session; Bukku's docs are Cloudflare-gated and the existing repo integration is credential-storage only). Topology: bank → Bukku feed → pull raw lines → us; we keep only date/amount/description/reference and discard Bukku's GL coding. (b) the LLM residual pass for fee-net card settlements, batched deposits, and partial payments; ✅ **cash-clearing journal posts on every match** (`agents/clearing.ts`): commitMatch now posts DR bank / CR channel-debtor(+SST) for AR and DR payable / CR bank for AP, so the GL cash position is correct (not just `paid_amount`). The AR split mirrors ar.ts exactly (channel debtor at net + SST in 1000-02), so clearing unwinds what was booked with no AR-agent change. Posts first so a period-lock/balance failure leaves the line retryable. `transaction` targets and partials handled. ✅ **AR candidates now exist** — on a confident post the AR agent emits one channel-tagged `fin_invoices` row per non-zero channel (`agents/ar-invoices.ts`), `total` = channel net + its proportional SST share (what the bank receives), deterministic `invoice_number` for idempotency. The Matcher reconciles bank settlements against these. Low-confidence days emit no invoices until the channel-split exception is resolved.
4. **AP autopilot** — ✅ works from manual upload. Add supplier-doc **email inbox** ingestion (replaces manual courier step).
5. **Exception resolvers (all types)** — ✅ **`match` resolver built.** `inbox.ts` now resolves match exceptions: `approve` accepts the Matcher's proposal, `match` is an explicit human pick, `dismiss` flags the bank line `ignored`. All go through the shared `commitMatch` (same accounting as the auto-Matcher) and tag the Matcher's `fin_agent_decisions` row as the training signal (confirmed vs corrected). `/api/finance/exceptions/:id/resolve` accepts the `match` action. Still pending: AR-`categorization` resolution (re-post the day with a corrected channel split) and anomaly / missing-doc / out-of-balance resolvers.
6. **Compliance** — MyInvois sandbox + SST-02 + period close (mostly built; prod credentials + JKDM filing stay behind the human signature).
7. **Reporting + audit** — ✅ done. P&L, BS, CF + auditor pack.
8. **Anomaly + polish** — ✅ **Anomaly sweep built** (`agents/anomaly-detectors.ts` pure + `agents/anomaly.ts` IO + `/api/finance/anomaly` trigger): deterministic, raise-only self-check producing `duplicate` (same supplier + bill number), `out_of_balance` (posted txn debits≠credits), `missing_doc` (posted AR/AP with no source doc), and `anomaly` (bill far above the supplier's own 12-month median — needs both a 4× multiple and a material absolute jump, so cheap suppliers don't spam). Idempotent (one open exception per row+type); the inbox surfaces them (dismiss works today; type-specific approve/reverse resolvers are a follow-up). ✅ **Nightly orchestration wired** — `lib/finance/orchestrator.ts` `runNightlyClose(date)` chains EOD ingest → Matcher (trailing 7-day window, catches late settlements) → Anomaly sweep, each idempotent and failure-isolated; the `finance-eod` cron (4 AM MYT) now runs the whole loop. Still pending: WhatsApp digest, Ask box (NL queries), and the **Fable 5 nightly orchestrator** layered on top — it investigates non-reconciling outlets and writes the digest, and does not categorize individual lines (Haiku/Sonnet stay on per-line work).

## Cutover (revised 2026-06-13 — bank feed is the validation harness)

With Bukku demoted to a bank-feed pipe (not a parallel ledger), the **bank statement is the external ground truth**, and the **Matcher is the cutover gate**: the ledger is proven correct when, for a full month, internal POS/online tender totals reconcile to the bank-fed transactions and to the posted journals — daily, per outlet.

- Run the module in report-only mode for ≥1 full month (post journals; do not yet drive outbound filings).
- AR: internal EOD aggregator posts daily; reconcile posted revenue against the Bukku-fed bank lines via the Matcher.
- AP: supplier docs run through the AP agent; spot-check coding against historical Bukku categorization for the same vendors (one-time export, read-only).
- **Pass criteria:** for the parallel month — (a) every bank line is matched or sits in the exception inbox with a proposed action, (b) per-outlet daily tender-vs-bank variance is within RM 1, (c) no unexplained gaps either side. Bukku ledger parity is **no longer** a pass criterion (we are not keeping Bukku's books).
- After pass: Bukku's ledger data is exported and archived; the Bukku subscription is downgraded to bank-feed only. The module is sole book of record.

## Open questions

1. **Bukku bank-feed API read-access** *(blocks Phase 3)* — confirm `developers.bukku.my` exposes bank-feed transaction lines for retrieval, the endpoint shape, and pagination/incremental-pull semantics. If read-access is not available, fall back to Maybank scheduled-statement email → parser.
2. **MyInvois timeline** — Celsius is on the LHDN mandate. Confirm whether the module's compliance phase ships before or after the e-invoice deadline.
3. **Cutover date** — original 2026-06-01 parallel-run start has passed. Re-baseline: pick a realistic report-only month start now that the harness is the bank feed (not Bukku parity).
4. **External auditor** — confirm auditor accepts our PDF/CSV pack. If they require AutoCount/SQL format specifically, add an export adapter.
5. **Bukku subscription tier** — confirm the minimum Bukku plan that retains the Maybank/CIMB/RHB bank feed + API access, so the conduit cost is known.
