-- Revenue Monster payout (daily settlement) tracking for the backoffice finance tab.
-- Auto-synced from RM Open API POST /v3/payment/settlement/csv by the
-- apps/order /api/cron/sync-rm-payouts cron. The finance Payouts page reads these
-- read-only and links each settled transaction back to its Celsius order.
--
-- Naming matches the Prisma-managed finance tables (BankStatement / BankStatementLine):
-- PascalCase table identifiers + camelCase quoted columns (NO @map in the Prisma model),
-- so prisma.rmPayout / prisma.rmPayoutLine map directly. Mirrored as Prisma models in
-- packages/db/prisma/schema.prisma. Manual SQL only — never `prisma db push`.

CREATE TABLE IF NOT EXISTS "RmPayout" (
  "id"               text PRIMARY KEY,                    -- natural key: "<date>_<method>_<seq>_<storeId>"
  "settlementDate"   timestamp(3) NOT NULL,
  "periodStart"      timestamp(3),
  "periodEnd"        timestamp(3),
  "method"           text NOT NULL,                       -- RM method code, e.g. FPX_MY / TNG_MY / card
  "sequence"         integer NOT NULL DEFAULT 1,          -- RM settlement batch sequence within a day
  "storeId"          text NOT NULL,                       -- our outlet slug: shah-alam / conezion / tamarind
  "entityName"       text,                                -- bank beneficiary / operating company
  "bankAccountLast4" text,
  "txnCount"         integer NOT NULL DEFAULT 0,
  "grossTotal"       numeric(12,2) NOT NULL DEFAULT 0,
  "mdrFee"           numeric(12,2) NOT NULL DEFAULT 0,
  "netTotal"         numeric(12,2) NOT NULL DEFAULT 0,
  "status"           text NOT NULL DEFAULT 'success',
  "syncedAt"         timestamptz  NOT NULL DEFAULT now(),
  "createdAt"        timestamp(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "RmPayout_settlementDate_idx" ON "RmPayout" ("settlementDate");
CREATE INDEX IF NOT EXISTS "RmPayout_storeId_idx"        ON "RmPayout" ("storeId");

CREATE TABLE IF NOT EXISTS "RmPayoutLine" (
  "id"               text PRIMARY KEY,                    -- = rmTransactionId (one settlement row per txn)
  "payoutId"         text NOT NULL REFERENCES "RmPayout"("id") ON DELETE CASCADE,
  "rmTransactionId"  text NOT NULL,
  "rmOrderId"        text,                                -- RM order id "C-xxxx-<base36>"
  "orderId"          text,                                -- matched Celsius orders.id (null = unlinked)
  "gross"            numeric(12,2) NOT NULL DEFAULT 0,
  "mdrFee"           numeric(12,2) NOT NULL DEFAULT 0,
  "net"              numeric(12,2) NOT NULL DEFAULT 0,
  "method"           text,
  "txnTime"          timestamp(3),
  "createdAt"        timestamp(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "RmPayoutLine_payoutId_idx"        ON "RmPayoutLine" ("payoutId");
CREATE INDEX IF NOT EXISTS "RmPayoutLine_orderId_idx"         ON "RmPayoutLine" ("orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "RmPayoutLine_rmTransactionId_key" ON "RmPayoutLine" ("rmTransactionId");
