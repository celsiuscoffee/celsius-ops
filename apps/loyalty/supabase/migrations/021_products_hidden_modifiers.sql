-- 021_products_hidden_modifiers.sql
--
-- Backoffice menu UX: customers see modifiers synced from StoreHub, but
-- some are noisy ("ice level", "cup type") or commercially undesirable
-- ("free upgrade") and the team wants to hide them without losing the
-- StoreHub source-of-truth — so the next sync doesn't undo the change.
--
-- Approach: a soft-blacklist column. Sync continues to upsert the full
-- modifier set as it comes from StoreHub; a separate `hidden_modifier_ids`
-- array names which group IDs and option IDs to filter out. Both consumers
-- (pickup-native customer app + backoffice menu page) apply the filter at
-- read time. Re-show is just removing an id from the array — the source
-- modifier object never gets destroyed.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS hidden_modifier_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN products.hidden_modifier_ids IS
  'Soft-blacklist of modifier group IDs and option IDs (UUIDs from StoreHub) to hide from customers. Filtered at read time on both pickup-native and backoffice menu page.';
