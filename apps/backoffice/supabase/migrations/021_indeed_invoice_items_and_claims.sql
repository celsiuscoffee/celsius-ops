-- NOT YET APPLIED to production. Apply with owner approval.
--
-- Recruitment ad claim tracking. Two gaps this closes:
--
-- 1. NO LINE ITEMS. indeed_ads_invoice holds only the invoice total, so there
--    was no way to see WHOSE jobs an invoice paid for. Invoice SGI26-00182946
--    (13 Aug 2026, USD 540.26) turns out to be 61.5% "Gosame International Sdn
--    Bhd" — a different company — billed to the Celsius Indeed account. That
--    is a receivable, not a Celsius cost, and nothing in the system could show
--    it. The itemized CSV export from employers.indeed.com carries company,
--    job title and location per line; this table stores it.
--
-- 2. NO CLAIM TRAIL. The director pays Indeed by card and reimburses himself
--    later, lagging 1-4 months (of August-2026's RM18,575 of claims only 12%
--    was August spend). The invoice had `status` but nothing recording when it
--    was claimed, when the reimbursement cleared, or which bank line settled
--    it.

CREATE TABLE IF NOT EXISTS public.indeed_ads_invoice_item (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL REFERENCES public.indeed_ads_invoice(id) ON DELETE CASCADE,
  -- The billed entity as printed on the itemized report. NOT always Celsius.
  company_name    TEXT NOT NULL,
  -- True when company_name is a Celsius entity; false = recoverable from a
  -- third party. Set at import, never inferred at read time.
  is_celsius      BOOLEAN NOT NULL DEFAULT TRUE,
  job_key         TEXT,
  reference_number TEXT,
  job_title       TEXT,
  location        TEXT,
  outlet_id       TEXT,
  quantity        INTEGER,
  unit            TEXT,
  average_cost    NUMERIC(12, 4),
  amount_usd      NUMERIC(12, 2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS indeed_ads_invoice_item_invoice_idx ON public.indeed_ads_invoice_item (invoice_id);
CREATE INDEX IF NOT EXISTS indeed_ads_invoice_item_company_idx ON public.indeed_ads_invoice_item (company_name);

-- Claim trail on the invoice itself.
ALTER TABLE public.indeed_ads_invoice
  ADD COLUMN IF NOT EXISTS claimed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reimbursed_at   TIMESTAMPTZ,
  -- BankStatementLine.id of the reimbursement. No FK: that table is Prisma-owned.
  ADD COLUMN IF NOT EXISTS bank_line_id    TEXT,
  ADD COLUMN IF NOT EXISTS fx_rate         NUMERIC(12, 6);

CREATE INDEX IF NOT EXISTS indeed_ads_invoice_bank_line_idx ON public.indeed_ads_invoice (bank_line_id);
