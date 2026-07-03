-- 067_ads_budget_change.sql
-- Budget-cut optimizer for the local-rank / ad-spend loop.
--
-- ads_budget_change: the APPROVAL LEDGER for cutting a Smart campaign's daily
-- budget so the freed spend can be redeployed to other marketing. Rows are only
-- ever created by an explicit human decision on the Optimizer page; the Google
-- Ads CampaignBudget mutation fires on approval, never automatically.
-- prev_daily_micros retains the pre-cut amount so a cut can be undone.

CREATE TABLE IF NOT EXISTS ads_budget_change (
  id                       text PRIMARY KEY,
  campaign_id              text NOT NULL REFERENCES ads_campaign(id) ON DELETE CASCADE,
  status                   text NOT NULL, -- applied | failed | rejected
  prev_daily_micros        bigint,
  new_daily_micros         bigint NOT NULL,
  monthly_saving_myr       numeric(12,2),
  proj_conv_lost_per_month integer,
  reason                   text,          -- the efficiency evidence at decision time
  budget_resource          text,          -- Google Ads CampaignBudget resource name
  error                    text,
  decided_by               text,
  decided_at               timestamptz NOT NULL DEFAULT now(),
  applied_at               timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ads_budget_change_campaign_idx
  ON ads_budget_change (campaign_id, decided_at DESC);
