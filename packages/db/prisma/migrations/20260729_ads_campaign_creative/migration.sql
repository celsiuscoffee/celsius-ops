-- Snapshot of Smart-campaign creative + targeting so the optimiser can finally
-- SEE what it is buying: the ad copy being served, its images, the landing page
-- the click lands on, the geo radius and the ad schedule.
--
-- Until now the ads sync covered accounts, campaigns, metrics, keywords and
-- search terms only. Nothing recorded the ads themselves, so "optimise the ad
-- text / image / landing page" was unanswerable — and the 2026-07-21 negative
-- keyword regression is the standing evidence of what mutating an unobserved
-- surface costs.
--
-- payload is jsonb on purpose: Google's Smart-campaign shapes differ per kind
-- and gain fields without notice; a column per field would mean a migration
-- every time. Read-only — written by syncAdCreative, never by the autopilot.

CREATE TABLE IF NOT EXISTS public.ads_campaign_creative (
  id          text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES public.ads_campaign(id) ON DELETE CASCADE,
  kind        text NOT NULL,           -- ad | setting | geo | schedule | asset
  ref         text NOT NULL,           -- Ads resource name (stable within a kind)
  payload     jsonb NOT NULL,
  synced_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ads_campaign_creative_campaign_kind_ref_key
  ON public.ads_campaign_creative (campaign_id, kind, ref);

CREATE INDEX IF NOT EXISTS ads_campaign_creative_campaign_kind_idx
  ON public.ads_campaign_creative (campaign_id, kind);
