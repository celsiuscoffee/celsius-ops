-- AP auto-match link: tie a bank outflow line to the procurement invoice it
-- settled, so the finance loop can mark the invoice paid, drop the line out of
-- P&L opex (it settles a liability, not a new expense), and avoid re-matching.
-- Additive + idempotent. Already applied to the live DB; tracked here for parity.
ALTER TABLE "BankStatementLine" ADD COLUMN IF NOT EXISTS "apInvoiceId" TEXT;
ALTER TABLE "BankStatementLine" ADD COLUMN IF NOT EXISTS "apMatchedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "BankStatementLine_apInvoiceId_idx" ON "BankStatementLine" ("apInvoiceId");
