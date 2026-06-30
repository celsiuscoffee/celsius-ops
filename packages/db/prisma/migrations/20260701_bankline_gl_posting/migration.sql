-- Bank-feed → GL posting bridge: idempotency link from a bank line to the
-- journal it was posted into. Null = not yet in the ledger.
ALTER TABLE "BankStatementLine" ADD COLUMN IF NOT EXISTS "glTransactionId" TEXT;
ALTER TABLE "BankStatementLine" ADD COLUMN IF NOT EXISTS "glPostedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "BankStatementLine_glTransactionId_idx" ON "BankStatementLine"("glTransactionId");
