-- Persist the burned wallet-voucher id on a POS sale so refunds can restore it.
--
-- Applied to the live project (kqdcdhpnyuwrxqhbuyfl) as migration
-- pos_orders_loyalty_voucher_id.
--
-- Before this, a wallet voucher consumed on a POS sale (apps/pos checkout calls
-- /api/loyalty/mark-used with the issued_rewards id) left no link on the order,
-- so a refund could not re-activate it — the customer permanently lost the
-- voucher. The refund route now reads this column and, on a FULL refund, flips
-- the issued_reward back to status='active'.

alter table public.pos_orders add column if not exists loyalty_voucher_id text;
comment on column public.pos_orders.loyalty_voucher_id is
  'issued_rewards.id of a wallet voucher consumed on this sale; used to re-activate the voucher on full refund.';
