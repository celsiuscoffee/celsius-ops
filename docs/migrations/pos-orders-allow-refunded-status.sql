-- Allow status='refunded' on pos_orders.
--
-- Applied to the live project (kqdcdhpnyuwrxqhbuyfl) as migration
-- pos_orders_allow_refunded_status.
--
-- The refund route (apps/pos/src/app/api/pos/refund/route.ts) records each
-- refund as a separate pos_orders row with status='refunded' and a negative
-- total, and the Z-report (apps/backoffice/.../pos/z-report) keys on that
-- status as its refund marker. The status CHECK constraint, however, was
-- created from an older status set ('open','sent_to_kitchen','ready',
-- 'completed','cancelled') and never included 'refunded' — so every refund
-- insert failed the check and no refund could ever be recorded.
--
-- Data-safe: no existing pos_orders row uses 'refunded'.

alter table public.pos_orders drop constraint if exists pos_orders_status_check;
alter table public.pos_orders add constraint pos_orders_status_check
  check (status in ('open', 'sent_to_kitchen', 'ready', 'completed', 'cancelled', 'refunded'));
