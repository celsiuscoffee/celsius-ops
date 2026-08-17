# E-invoice & trap-table re-point — scope

Status: SCOPED (audit finding 3 of 3, 2026-08-15). Not built.
Origin: end-to-end finance audit; companion fixes: PR #1137 (audit actor),
PR #1138 (posted-journal guards).

## Problem

The compliance/e-invoice loop and three AP paths read tables that have been
empty since launch, so all of them are silent no-ops:

| Reader | Table | Effect today |
| --- | --- | --- |
| `agents/compliance.ts:101,256` (consolidated + B2B submission) | `fin_invoices` (0 rows) | No e-invoice has EVER been submitted — `fin_einvoice_submissions` is empty |
| `api/finance/einvoice/route.ts:25` (status UI) | `fin_invoices` | UI always empty |
| `reports/auditor-pack.ts:157,191` | `fin_invoices`, `fin_bills` | Auditor pack sections empty |
| `agents/ap.ts:135` (duplicate-bill check) | `fin_bills` (0 rows) | Duplicate supplier bills are never detected |
| `agents/categorizer.ts:66` (`supplierHistory` — its strongest signal) | `fin_bills` | Categorizer always runs context-blind |

Contradiction to resolve: `data-map.ts` marks `fin_bills` "never use", yet
`agents/ap.ts:261` and `inbox.ts:151` still WRITE it (the writes never fire —
the bills-upload pipeline is dormant — but the code disagrees with the map).

Verified 2026-08-15: `fin_einvoice_submissions` 0 rows; `fin_companies.tin`
NULL for all three companies; MyInvois client is env-gated AND sandbox-grade
(documents unsigned, `hashDocument()` returns ""); the only caller is the
manual route `api/finance/einvoice/consolidated` — there is no cron.

## Compliance stakes (verify before building)

Celsius Coffee Sdn. Bhd. 2025 revenue ≈ RM2.5M puts it in the RM1–5M
MyInvois band — mandatory from **1 Jan 2026** under the revised LHDN
timeline, with the 6-month grace ending ~Jun 2026. Conezion and Tamarind
(new 2026 entities) follow their own thresholds. The module has submitted
nothing; **whether the business is compliant depends on what the accountant
does outside this system**. That question gates everything else:

> **Owner/accountant question 1:** are consolidated e-invoices currently
> being filed via the MyInvois portal (or by the accountant) for each
> entity? Since when, and for which months?

If yes → phases 2–3 become "bring filing in-house" (nice-to-have, lower
urgency) and phase 1 (trap-table kill) proceeds alone. If no → phase 2 is a
compliance gap to close urgently, and interim manual portal filing should
start now regardless of this build.

## Design decisions

1. **B2C consolidated source = `unified_sales`, not `fin_invoices`.**
   The consolidated e-invoice is a monthly aggregate of retail receipts per
   entity/outlet. `unified_sales` is the canonical till lens (pos_native +
   grabfood + pickup + consignment) and reconciles to the sen. The
   `ar_invoice` GL journals are already day/channel aggregates and lose the
   receipt-number ranges LHDN wants on consolidated line items.
2. **AP-side history source = `Invoice` (PascalCase).** 3,028 rows, live.
   Duplicate check: same supplier + invoice number. Supplier history for
   the categorizer: `Invoice` join to its GL landing — via ap-matched
   `BankStatementLine.category`/`fin_journal_lines` — is the truthful
   "where did this supplier's bills post before" signal; fallback to
   `fin_agent_decisions` for suppliers with decisions but no matched lines
   yet. (This is the trickiest re-point; isolate it behind the existing
   `supplierHistory()` signature.)
3. **Stop writing `fin_bills`; tombstone both tables.** AP auto-post and
   inbox approve keep their GL postings, drop the `fin_bills` insert, and
   carry the bill metadata they used to store in the `fin_documents`
   `parsed` payload (already written today). After phase 1 the dead-table
   guard (warehouse check 2) can finally go to "must not exist" instead of
   "must stay 0".
4. **`fin_einvoice_submissions` keys on (company, outlet, period), not
   `invoice_id`.** The FK to `fin_invoices` dies with the table; B2B
   per-invoice submissions (GastroHub, events — low volume) reference the
   AR journal id instead.
5. **Submission stays human-approved.** Filing a tax document is a legal
   act — same class as period close. The cron only assembles the draft +
   Telegram-nudges by day 5; a human presses submit (day-7 LHDN deadline
   for the prior month).

## Phases

**Phase 0 — facts & credentials (human, blocks 2–3):**
owner/accountant question 1 above; enter TIN/BRN/MSIC/SST-status for all
three companies into `fin_companies` (data exists in company records);
obtain MyInvois production client-id/secret per entity + the signing
certificate. Zero code.

**Phase 1 — trap-table kill (1 PR, no behaviour risk, do now):**
re-point ap dup-check + `supplierHistory()` to `Invoice`; drop the two
`fin_bills` writes; re-point auditor-pack + einvoice status route; update
`data-map.ts` + warehouse skill check 2; tombstone migration for
`fin_invoices`/`fin_bills` via the housekeeping propose-only path
(`prevent_drop_critical_tables()` amended in the same migration).
Estimate: ~1 day. Depends on nothing.

**Phase 2 — consolidated e-invoice on live data (1 PR):**
monthly builder `unified_sales` → per-entity/outlet consolidated
`EinvoiceDocument` (receipt-range line aggregation, general-public TIN);
schema tweak per decision 4; assembly cron + Telegram nudge; approve/submit
route (OWNER/ADMIN); rejection surfacing in the exception inbox.
Estimate: ~2–3 days. Depends on phase 0.

**Phase 3 — MyInvois production hardening (1 PR):**
document signing with the MDEC certificate (replaces the empty-hash
sandbox shortcut), production env config per entity, retry/backoff,
sandbox smoke test kept runnable. Estimate: ~2 days; certificate lead time
is the real critical path. Depends on phase 0.

B2B per-invoice flow (GastroHub vendors, events): defer until B2C
consolidated is live; volume is a handful/month and can be filed manually
on the portal meanwhile.

## Risks / notes

- Phase 2 must NOT double-file months the accountant already filed via the
  portal (question 1 determines the backfill boundary; store externally
  filed months as `status='external'` rows for completeness).
- Consignment (GastroHub/IOI) sales sit inside `unified_sales` — confirm
  with the accountant whether they belong in Celsius's consolidated
  e-invoice or the counterparty's (they invoice the end customer).
- SST: entities are not SST-registered (sst fields stay empty in the
  document builder — already the case).
- The categorizer re-point (decision 2) changes its input distribution;
  log decisions under a bumped `CATEGORIZER_VERSION` so eval cohorts stay
  comparable (finance-module skill rule).
