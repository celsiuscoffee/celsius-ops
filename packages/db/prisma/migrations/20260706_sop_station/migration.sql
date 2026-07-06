-- Add a physical STATION to each SOP so checklist auto-assignment can route
-- work to the right job positions (bar person owns the bar, kitchen the
-- kitchen). Replaces the hardcoded title→station map in ops-nudges with a
-- data-driven, manager-editable field. See:
--   docs/design/checklist-individual-accountability.md (Approach B)

-- CreateEnum
CREATE TYPE "SopStation" AS ENUM ('barista', 'kitchen', 'lead', 'cleaning', 'shared');

-- AlterTable (nullable = "not mapped"; app falls back to the title map, then cleaning)
ALTER TABLE "Sop" ADD COLUMN "station" "SopStation";

-- Backfill the existing SOP library. Ice machine + door/window live at the bar
-- (barista); toilet cleaning is whole-outlet (shared). Matched case-insensitively
-- on title so it catches per-outlet copies.
UPDATE "Sop" SET "station" = 'barista'
  WHERE lower(title) IN ('coffee calibration', 'ice machine cleaning', 'door & window cleaning');

UPDATE "Sop" SET "station" = 'kitchen'
  WHERE lower(title) IN ('fridge & storage', 'first food out', 'pest control check');

UPDATE "Sop" SET "station" = 'shared'
  WHERE lower(title) IN ('grease trap cleaning', 'opening checklist', 'closing', 'toilet cleaning');
