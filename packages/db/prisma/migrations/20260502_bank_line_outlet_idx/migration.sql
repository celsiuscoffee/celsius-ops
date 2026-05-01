-- Add (outletId, txnDate) composite to BankStatementLine.
-- The cashflow projection runs three lookbacks (90 days projection,
-- 12 months operating cash flow, 12 months min balance) that filter
-- by outletId + txnDate range. Existing indexes (txnDate, statementId,
-- (category, outletId)) cover most paths but not the per-outlet
-- temporal slice. Without this composite, outlet-filtered cashflow
-- queries do partial seq scans as the table grows past ~20k rows.
-- Applied via Supabase MCP on 2026-05-02.

CREATE INDEX IF NOT EXISTS "BankStatementLine_outletId_txnDate_idx"
  ON "BankStatementLine" ("outletId", "txnDate" DESC);
