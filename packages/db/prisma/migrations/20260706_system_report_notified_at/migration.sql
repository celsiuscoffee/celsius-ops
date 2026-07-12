-- Stamp when the reporter was WhatsApp-notified their report was resolved (notify cron).
-- SystemReport is brand-new and empty; nullable ADD COLUMN is zero-risk. Idempotent.
ALTER TABLE "SystemReport" ADD COLUMN IF NOT EXISTS "reporterNotifiedAt" TIMESTAMP(3);
