-- Rewards refactor — Commit 3 (safe slice): catalog reads templates — applied 2026-05-31
-- Spec: docs/rewards-storehub-refactor.md
--
-- Points the customer Bean-Shop catalog at voucher_templates instead of
-- the legacy `rewards` table, killing the 6-row list duplication
-- (3 catalog + 3 mirror) from Commit 1. The `rewards` TABLE is NOT
-- dropped — it's still the redemption/mint source during the grace
-- window (30+ references across 4 apps). Full DROP is a later,
-- multi-app effort.
--
-- DB side (this file). Code side: packages/shared affordable-catalog
-- now reads voucher_templates; backoffice all-rewards GET stops
-- fetching `rewards`.

-- legacy_reward_id lets the catalog reader return the original text id
-- so redeem/mint (which still read `rewards`) keep resolving. The
-- AffordableCatalogReward.id stays the legacy 'reward-X' id, unchanged
-- for clients.
ALTER TABLE voucher_templates
  ADD COLUMN IF NOT EXISTS legacy_reward_id text;

-- Backfill the 3 Bean-Shop mirrors by reversing the deterministic UUID.
UPDATE voucher_templates t
   SET legacy_reward_id = r.id
  FROM rewards r
 WHERE t.brand_id = 'brand-celsius'
   AND t.points_cost IS NOT NULL
   AND t.id = uuid_generate_v5(uuid_ns_url(), 'rewards-catalog:' || r.id);

-- Drop the "(Bean Shop)" disambiguator suffix — these titles now show
-- to customers in the catalog. The Bean-Shop trigger chip + points_cost
-- distinguish them in the backoffice list, so the suffix is redundant.
UPDATE voucher_templates
   SET title = regexp_replace(title, '\s*\(Bean Shop\)$', '')
 WHERE brand_id = 'brand-celsius'
   AND points_cost IS NOT NULL
   AND title LIKE '% (Bean Shop)';

-- Verify: 3 points-shop templates, clean titles, legacy ids present.
-- SELECT legacy_reward_id, title, points_cost FROM voucher_templates
--  WHERE brand_id='brand-celsius' AND points_cost IS NOT NULL ORDER BY points_cost;
--   reward-3              | RM5        | 100
--   reward-1776593225967  | RM10       | 200
--   reward-1              | Free Drink | 300
