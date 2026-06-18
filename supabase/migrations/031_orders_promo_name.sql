-- Record WHICH promotion produced a customer order's promo discount.
--
-- `orders.promo_discount` already stores the promo-engine discount AMOUNT (tier
-- perk / auto store promo / reward-link), but not its NAME — so a receipt or
-- report could show "−RM21.45" with no idea it was e.g. "Arba & Staff — 30%
-- off". This adds the human label, written at order creation from the winning
-- promo-engine legs (AppliedDiscount.promotion_name). Mirrors pos_orders, which
-- already carries promo_name.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS promo_name text;
