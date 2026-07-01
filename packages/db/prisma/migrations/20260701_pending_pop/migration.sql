-- Persisted Proof-of-Payment (POP) that the Telegram matcher could not auto-link to a single
-- invoice (ambiguous → multiple candidates). Lets BackOffice surface a "possible POP match" on
-- each candidate invoice for a human to confirm. Idempotent (IF NOT EXISTS) per repo convention.
CREATE TABLE IF NOT EXISTS "PendingPop" (
  "id"                  TEXT NOT NULL,
  "token"               TEXT,
  "amount"              DECIMAL(65,30) NOT NULL,
  "referenceNumber"     TEXT,
  "payeeName"           TEXT,
  "bankName"            TEXT,
  "invoiceReference"    TEXT,
  "date"                TIMESTAMP(3),
  "photoUrl"            TEXT,
  "candidateInvoiceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"              TEXT NOT NULL DEFAULT 'OPEN',
  "source"              TEXT DEFAULT 'telegram',
  "resolvedInvoiceId"   TEXT,
  "resolvedById"        TEXT,
  "resolvedAt"          TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PendingPop_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PendingPop_status_idx" ON "PendingPop" ("status");
CREATE INDEX IF NOT EXISTS "PendingPop_token_idx" ON "PendingPop" ("token");
