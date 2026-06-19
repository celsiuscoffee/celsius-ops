-- GrabFood marketing: synced campaigns, manual GrabAds spend, and the
-- per-order merchant-funded promo cost.
--
-- "Marketing" for GrabFood splits into two costs:
--   • promo/campaign cost — merchant-funded discounts. The order webhook gets
--     this as price.merchantFundPromo, but we used to MERGE it with Grab-funded
--     promo into discount_amount. Only the merchant-funded part is OUR cost, so
--     capture it on its own column.
--   • GrabAds paid advertising — a separate Grab product NOT exposed by the
--     Partner API, so its spend is entered manually (grab_ads_spend).
-- Campaigns themselves are mirrored read-only from GET /partner/v1/campaigns.
--
-- All additive (new column defaulted, new tables) — safe to run anytime.

ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS grab_merchant_promo integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS grab_campaigns (
  id               text PRIMARY KEY,
  outlet_id        text NOT NULL,
  grab_campaign_id text NOT NULL,
  name             text,
  created_by       text,           -- PARTNER | MERCHANT | GRAB
  status           text,
  discount_summary text,
  raw              jsonb,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_id, grab_campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_grab_campaigns_outlet ON grab_campaigns(outlet_id);

CREATE TABLE IF NOT EXISTS grab_ads_spend (
  id           text PRIMARY KEY,
  outlet_id    text NOT NULL,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  amount_sen   integer NOT NULL,
  note         text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grab_ads_spend_outlet ON grab_ads_spend(outlet_id, period_start);
