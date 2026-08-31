-- NOT YET APPLIED to production. Apply with owner approval, together with
-- packages/db/prisma/migrations/20260831_cashcategory_recruitment (the
-- CashCategory enum value this account backs).
--
-- Adds 6502-05 "Recruitment" under Employee Benefits for job-board spend
-- (Indeed). Previously these lines had nowhere correct to go:
--   * 6503-01 Digital Ads is deduped out of bank opex against the Google ads
--     module, and the Indeed tables (indeed_ads_invoice,
--     indeed_ads_metric_daily) are EMPTY — routing them there erased the cost.
--   * 6503 Marketing & Advertising keeps the cost but reports a hiring spend
--     inside the marketing line.
--
-- Volume: RM13,922.43 across 11 claims since Jan-2025, all reimbursed through
-- the director; RM4,165.92 in Aug-2026 alone, the largest month on record.
--
-- New code, not a renumber — existing codes stay stable per the finance-module
-- invariants. Idempotent.

insert into fin_accounts (code, name, type, subtype, parent_code, is_system, outlet_specific) values
  ('6502-05', 'Recruitment',                                'expense',   null,            '6502', false, false)
on conflict (code) do nothing;
