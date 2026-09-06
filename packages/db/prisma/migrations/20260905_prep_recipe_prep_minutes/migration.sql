-- Prep labour time on the central-kitchen sub-BOM.
--
-- NOT YET APPLIED to prod — awaiting owner approval (hard rule 6).
-- Once applied, the applied-history copy belongs in supabase/migrations/;
-- this file is the never-executed audit trail CI's migration-guard checks.
--
-- CONTEXT. ProductRecipe already describes what a prep batch CONSUMES (raw
-- inputs) and what it YIELDS, so the batch can be costed in ringgit. Nothing
-- described what it COSTS IN TIME, so there was no way to answer "do we have
-- enough manhours to prep this week?" — the owner's question on 2026-09-05.
--
-- prepMinutes = hands-on minutes for ONE person to produce one batch (the
-- recipe's yieldQuantity), start to finish. Minutes per prepped unit is
-- prepMinutes / yieldQuantity, which the prep-labour report multiplies by the
-- units the outlets' sales actually consumed to get required manhours.
--
-- NULLABLE on purpose: an untimed recipe must read as "not timed yet", never as
-- zero work. The report counts those separately so a partial rollout cannot
-- quietly understate the labour needed.

ALTER TABLE "ProductRecipe" ADD COLUMN IF NOT EXISTS "prepMinutes" DECIMAL(10,2);

COMMENT ON COLUMN "ProductRecipe"."prepMinutes" IS
  'Hands-on minutes for ONE person to produce one batch (yieldQuantity). NULL = not timed yet.';
