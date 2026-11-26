-- Add CashCategory channel IPAY88 — online (pickup app + table-QR) settlement
-- from iPay88 / ADAPTIS (NTT DATA eCommerce Solutions Sdn. Bhd.), the gateway
-- replacing Stripe and Revenue Monster. Mirrors REVENUE_MONSTER
-- (20260629_cashcategory_revenue_monster_dividend).
-- Additive + idempotent. APPLIED to the live DB 2026-09-24 via Supabase
-- apply_migration (owner-approved); verified in pg_enum, 0 rows use it.
-- The finance code that classifies/posts IPAY88 lines is deliberately NOT
-- shipped yet (owner: wire payments first) — it lives in commit eec28bf.

-- AlterEnum
ALTER TYPE "CashCategory" ADD VALUE IF NOT EXISTS 'IPAY88';
