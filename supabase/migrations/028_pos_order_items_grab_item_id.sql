-- Grab's own per-line item id (the order item's grabItemID) on each Grab order
-- line. Needed to build the GrabFood Edit Order payload (PUT /partner/v2/orders/
-- {orderID}), which requires Grab's itemID for every existing line. We resolve
-- the display product via products.grab_item_id, but that's a different id — this
-- captures the raw line-level grabItemID the order webhook receives.
ALTER TABLE pos_order_items
  ADD COLUMN IF NOT EXISTS grab_item_id text;
