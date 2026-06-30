-- Add two CashCategory channels:
--   REVENUE_MONSTER — online (pickup + table-QR) settlement, its own sales channel
--   DIVIDEND        — shareholder distributions, split out of OTHER_OUTFLOW so the
--                     cashflow projection stops smearing them as operating burn
-- Additive + idempotent. Already applied to the live DB; tracked here for parity.
ALTER TYPE "CashCategory" ADD VALUE IF NOT EXISTS 'REVENUE_MONSTER';
ALTER TYPE "CashCategory" ADD VALUE IF NOT EXISTS 'DIVIDEND';
