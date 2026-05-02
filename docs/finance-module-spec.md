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
SOURCES                AGENTS              LEDGER (us)         OUTBOUND

StoreHub ─┐                                                   ┌─→ MyInvois (LHDN)
Maybank  ─┼─→ Ingestor ─→ Categorizer ─→ fin_transactions ───┼─→ SST-02 (Customs)
Email    ─┤            ─→ Matcher        + fin_journal_lines  ├─→ Auditor pack
WhatsApp ─┤            ─→ AP                                  ├─→ WhatsApp digest
HR       ─┘            ─→ AR             ↓                    └─→ Bank payment files
                       ─→ Close       Exception inbox
                       ─→ Compliance  (only human surface)
                       ─→ Anomaly
```

We are a single-tier system. No external book of record. Bukku stays read-only for historical reference until decommission.

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

1. **Foundation (week 1-2)** — Schema migration `002_finance_module.sql` + COA seed `003_finance_coa_seed.sql` + RLS + scaffolded routes.
2. **AR autopilot (week 2-3)** — StoreHub EOD ingest → AR agent → posts journals. Bank ingest (Maybank statement upload v1) + Matcher. `/finance/transactions` + `/finance` home live.
3. **AP autopilot (week 3-4)** — Email/WhatsApp inbox for supplier docs → AP agent. Exception inbox UI live.
4. **Compliance (week 4-6)** — MyInvois sandbox + SST-02 + period close.
5. **Reporting + audit (week 6-7)** — P&L, BS, CF generators. Auditor pack export. Year-end checklist agent.
6. **Polish** — WhatsApp digest, Ask box (NL queries on the ledger), Anomaly agent.

## Cutover from Bukku

- Run new module in parallel for ≥1 full month.
- AR: every StoreHub EOD posts to BOTH systems. Compare daily.
- AP: every supplier bill entered manually in Bukku also runs through the AP agent for the parallel month. Compare end-of-month.
- Bank recon: same statement uploaded to both. Compare match rates.
- Pass criteria: P&L, BS, CF reconcile within RM 1 of Bukku for the parallel month, no missing transactions either side.
- After pass: stop posting to Bukku. Bukku data exported and archived. Module becomes sole source.

## Open questions

1. **MyInvois timeline** — Celsius is on the LHDN mandate. Confirm whether Phase 1 ships before or after the e-invoice deadline; if before, parallel filing via Bukku needs explicit plan.
2. **Cutover date** — propose 2026-06-01 as parallel-run start, 2026-07-01 as Bukku decommission.
3. **External auditor** — confirm auditor accepts our PDF/CSV pack. If they require Bukku/SQL/AutoCount format specifically, we add an export adapter.
