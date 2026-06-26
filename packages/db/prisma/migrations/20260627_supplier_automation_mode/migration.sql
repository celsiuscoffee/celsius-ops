-- Per-supplier procurement automation dial (the hybrid model).
-- OFF = manual only; ASSIST = agent/exec draft + a human approves; AUTO = act + send.

-- CreateEnum
CREATE TYPE "AutomationMode" AS ENUM ('OFF', 'ASSIST', 'AUTO');

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "automationMode" "AutomationMode" NOT NULL DEFAULT 'OFF';

-- Seed: put the test supplier (used to validate the loop) into ASSIST so the hybrid
-- flow can be exercised safely (drafts + human-approve) before any supplier is AUTO.
UPDATE "Supplier"
SET "automationMode" = 'ASSIST'
WHERE regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g') LIKE '%0109335369';
