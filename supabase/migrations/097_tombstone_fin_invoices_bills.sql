-- 097: tombstone fin_invoices and fin_bills (trap-table kill, phase 1 of
-- docs/design/einvoice-live-sources.md).
--
-- Both tables were built at module launch and NEVER populated (0 rows,
-- verified 2026-08-15), yet five code paths read them as silent no-ops:
-- the consolidated e-invoice flow, the e-invoice status UI, the AP
-- duplicate-bill check, the categorizer's supplier-history signal, and the
-- auditor pack. All readers/writers were re-pointed to live sources
-- (Invoice, unified_sales, posted ar_invoice journals) in the same PR.
--
-- fin_einvoice_submissions survives: it drops its FK to fin_invoices here
-- and gets re-keyed on (company, outlet, period) in phase 2. invoice_id is
-- kept as a plain text column (empty table — nothing references anything).
--
-- Note: prevent_drop_critical_tables() does not list either table, so no
-- guard amendment is needed (verified against migration 080's list).
-- fin_bank_transactions and fin_matches — the other two dead twins — are
-- NOT dropped here; they still have live guard-checks expecting 0 rows and
-- go through the housekeeping loop separately.

alter table fin_einvoice_submissions
  drop constraint if exists fin_einvoice_submissions_invoice_id_fkey;

drop table if exists public.fin_bills;
drop table if exists public.fin_invoices;
