-- Add CashCategory channel IPAY88 — online (pickup app + table-QR) settlement
-- from iPay88 / ADAPTIS (NTT DATA eCommerce Solutions Sdn. Bhd.), the gateway
-- replacing Stripe and Revenue Monster. Mirrors REVENUE_MONSTER
-- (20260629_cashcategory_revenue_monster_dividend).
-- Additive + idempotent. NOT YET APPLIED to the live DB — needs owner approval
-- (CLAUDE.md hard rule 6); listed in KNOWN_UNAPPLIED.json until it is.
-- Apply BEFORE merging code that classifies bank lines as IPAY88, or an
-- iPay88 settlement line would fail to insert.

-- AlterEnum
ALTER TYPE "CashCategory" ADD VALUE IF NOT EXISTS 'IPAY88';
