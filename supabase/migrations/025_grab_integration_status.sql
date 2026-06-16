-- Grab integration status per outlet — surfaced as a "connected" badge in the
-- BackOffice GrabFood admin (/settings/integrations/grab). GrabFood pushes the
-- store's integration status (ACTIVE / SYNCING / FAILED / INACTIVE) to our
-- /api/pos/grab/status webhook during/after self-serve activation; that route
-- persists it onto "Outlet" (resolved by loyaltyOutletId = the partner store id,
-- or by grabMerchantId). Read back in /api/integrations/grab GET.
ALTER TABLE "Outlet"
  ADD COLUMN IF NOT EXISTS "grabIntegrationStatus" text,
  ADD COLUMN IF NOT EXISTS "grabIntegrationStatusAt" timestamptz;

-- Backfill Putrajaya/Conezion: confirmed ACTIVE (self-serve activation succeeded 2026-06-16).
UPDATE "Outlet" SET "grabIntegrationStatus" = 'ACTIVE', "grabIntegrationStatusAt" = now()
  WHERE "loyaltyOutletId" = 'outlet-con';
