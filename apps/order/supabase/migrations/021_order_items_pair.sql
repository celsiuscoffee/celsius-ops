-- Upsell ("Pair with a Bite") attribution on pickup/app order lines.
--
-- The native pickup app stages a suggested pair as its own cart line, but until
-- now that signal only fired as an Amplitude `cart_add` event (add-to-cart) and
-- was never persisted — so we could not measure pairs that actually CHECKED OUT.
-- This flag marks an order line that originated from a pair suggestion, letting
-- the sales dashboard count purchased upsells and split them native vs web (via
-- orders.source). Forward-only: existing rows default to false.
--
-- Apply to the celsiuscoffee project (kqdcdhpnyuwrxqhbuyfl) via
-- apply_migration "add_order_items_pair".
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS is_pair boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.order_items.is_pair IS
  'True when this line came from a "Pair with a Bite" upsell suggestion (pickup/app). Counted by the sales dashboard as a purchased pair. Forward-only; legacy rows are false.';
