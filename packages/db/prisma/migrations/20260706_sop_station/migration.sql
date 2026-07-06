-- Tag each SOP with the house area(s) its work belongs to, so checklist
-- auto-assignment routes to the right staff (FOH = bar/barista, BOH = kitchen).
-- Multi-valued: a SOP can be FOH+BOH, or "shared" (anyone on shift). Replaces
-- the hardcoded title→station map in ops-nudges with a manager-editable field.
-- See docs/design/checklist-individual-accountability.md (Approach B).

-- CreateEnum
CREATE TYPE "SopStation" AS ENUM ('foh', 'boh', 'lead', 'shared');

-- AlterTable (empty array = "not mapped"; app falls back to the title map, then shared)
ALTER TABLE "Sop" ADD COLUMN "stations" "SopStation"[] NOT NULL DEFAULT '{}';

-- Backfill the existing SOP library. FOH (bar): coffee calibration, ice machine
-- (the machine is at the bar), door & window. BOH (kitchen): fridge, first food
-- out, pest control. Shared (whole outlet): grease trap, opening, closing, toilet.
UPDATE "Sop" SET "stations" = ARRAY['foh']::"SopStation"[]
  WHERE lower(title) IN ('coffee calibration', 'ice machine cleaning', 'door & window cleaning');

UPDATE "Sop" SET "stations" = ARRAY['boh']::"SopStation"[]
  WHERE lower(title) IN ('fridge & storage', 'first food out', 'pest control check');

UPDATE "Sop" SET "stations" = ARRAY['shared']::"SopStation"[]
  WHERE lower(title) IN ('grease trap cleaning', 'opening checklist', 'closing', 'toilet cleaning');
