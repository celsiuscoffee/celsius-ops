-- Serving-time lifecycle for COUNTER (till) orders — standardise the live-orders
-- flow across every channel.
--
-- Background: counter orders (dine-in "Stand #" + takeaway "Queue #") are rung
-- up at the till and written straight to status='completed'. That makes them an
-- instant, exact sale (the Z-report in shift.ts and the sales dashboard in
-- unified-sales.ts both count pos_orders only WHERE status='completed') — but it
-- also means they never appear in any live queue and their serving time
-- (order -> served) is never tracked, unlike Pickup / Grab / QR-table orders.
--
-- Fix: layer a serving lifecycle ON TOP of the completed sale via a nullable
-- served_at timestamp. The order still counts as a sale the instant it's rung up
-- (status is untouched — Z-report / sales totals are unaffected); served_at just
-- records WHEN a runner handed it over:
--
--   served_at IS NULL  -> still being served  -> shows on the on-register KDS
--                         (Counter tab) and is tracked by the 15-min serving alarm
--   served_at = <ts>    -> handed over / done   -> drops off the live queue
--
-- New counter orders insert via create_pos_sale, which does NOT set served_at,
-- so they default to NULL = live. Marking one served (POST /api/pos/order-status
-- with source='counter') stamps served_at = now().

ALTER TABLE public.pos_orders
  ADD COLUMN IF NOT EXISTS served_at timestamptz;

COMMENT ON COLUMN public.pos_orders.served_at IS
  'When a counter (till) order was handed to the customer. NULL = still live on the on-register KDS / serving alarm. Independent of status, which stays completed the moment the sale is rung up so Z-report + sales totals are exact.';

-- Backfill EVERY existing row as already-served (= created_at) so none of the
-- pre-feature history suddenly shows up as a live, overdue order after deploy.
UPDATE public.pos_orders
   SET served_at = created_at
 WHERE served_at IS NULL;

-- Hot path: the Counter KDS polls/streams "this outlet's un-served orders". A
-- partial index over just the NULL rows keeps that query cheap as the completed
-- (served) history grows without bound.
CREATE INDEX IF NOT EXISTS pos_orders_live_counter_idx
  ON public.pos_orders (outlet_id, created_at)
  WHERE served_at IS NULL;
