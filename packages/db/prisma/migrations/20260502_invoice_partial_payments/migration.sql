-- Lightweight partial-payment tracking on Invoice. amountPaid is a running
-- total — the deposit flow ALSO writes to it (deposit = first partial),
-- so a single field covers both 10/90 splits and ad-hoc multi-payments
-- without introducing a separate ledger table. If audit-grade history
-- becomes a requirement later (multiple POPs per invoice, who paid when),
-- we'll add an InvoicePayment table and derive amountPaid from a sum().
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "amountPaid" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- Backfill existing rows so the new field is consistent with what the
-- system already shows: PAID rows owe nothing; DEPOSIT_PAID rows have
-- already paid the deposit slice.
UPDATE "Invoice" SET "amountPaid" = "amount" WHERE "status" = 'PAID' AND "amountPaid" = 0;
UPDATE "Invoice"
  SET "amountPaid" = COALESCE("depositAmount", 0)
  WHERE "status" = 'DEPOSIT_PAID' AND "amountPaid" = 0 AND "depositAmount" IS NOT NULL;

-- New status: PARTIALLY_PAID — used when amountPaid is between 0 and
-- amount, but we're NOT in the strict deposit-then-balance flow (i.e.
-- ad-hoc partial payments). DEPOSIT_PAID stays as a distinct label so
-- the deposit-vs-balance UX keeps working.
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID';
