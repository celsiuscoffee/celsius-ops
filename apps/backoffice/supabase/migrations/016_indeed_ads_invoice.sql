-- ─────────────────────────────────────────────────────────────────────
-- Indeed invoices — manual tracking.
--
-- Indeed bills are not exposed via the Sponsored Jobs API for direct
-- employers (ATS partners only). We track invoices manually from the
-- employer billing portal at employers.indeed.com/billing so we can
-- reconcile API-reported spend against actual amounts charged.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.indeed_ads_invoice (
  id              TEXT PRIMARY KEY,
  invoice_number  TEXT UNIQUE,
  issue_date      DATE NOT NULL,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  amount_usd      NUMERIC(12, 2) NOT NULL,
  amount_myr      NUMERIC(12, 2),
  status          TEXT NOT NULL DEFAULT 'unpaid',
  pdf_url         TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS indeed_ads_invoice_issue_date_idx ON public.indeed_ads_invoice (issue_date DESC);
CREATE INDEX IF NOT EXISTS indeed_ads_invoice_status_idx     ON public.indeed_ads_invoice (status);
