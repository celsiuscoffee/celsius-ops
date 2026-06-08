-- Order origin attribution.
--
-- web_qr = web/PWA QR-table flow (/api/checkout/initiate), which is now
-- enforced dine-in-only. null = native pickup (/api/orders), POS register,
-- or older rows. Lets us audit that no web_qr order is ever a pickup:
--   select count(*) from orders where source = 'web_qr' and order_type <> 'dine_in';  -- must stay 0
--
-- Applied to the celsiuscoffee project (kqdcdhpnyuwrxqhbuyfl) via
-- apply_migration "add_orders_source".
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.orders.source IS
  'Order origin channel. web_qr = web/PWA QR-table flow (/api/checkout/initiate). null = legacy/native (/api/orders) or older rows.';
