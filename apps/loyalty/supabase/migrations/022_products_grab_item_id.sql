-- =============================================
-- 022: Link a catalog product to its GrabFood menu item id.
--
-- GrabFood order webhooks carry only Grab's own item id (e.g.
-- "MYITE2026011703282830543") which never matches our products.id. Without a
-- link, every Grab order line falls back to "Item @ RM x [MYITE202]" on the
-- docket/receipt because the product name can't be resolved from the catalogue.
--
-- The backoffice product catalogue is the source of truth, so we hang the Grab
-- item id on the product itself (set in BackOffice → Pickup → Menu → product).
-- The order webhook then resolves names by products.grab_item_id.
--
-- Nullable; unique when set so two products can't claim the same Grab item.
-- =============================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS grab_item_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_grab_item_id
  ON products (grab_item_id)
  WHERE grab_item_id IS NOT NULL;
