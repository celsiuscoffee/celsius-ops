-- Backfill the orphaned GrabFood payment rows.
--
-- grab-ingest.ts inserted pos_order_payments with status='paid', but the
-- pos_order_payments_status_check constraint only allows
-- pending|completed|failed|refunded. Every Grab payment insert was rejected
-- (23514) and swallowed (console.error, not thrown), so the ORDER landed but its
-- payment/tender row did not — ~488 GrabFood orders (RM18.7k) since 2026-06-17
-- with no payment row. The code is fixed to write 'completed' going forward
-- (grab-ingest.ts); this repairs the history.
--
-- Method defaults to 'grabpay': GrabFood MY is prepaid, the order does not store
-- the paymentType, and there are no cash-on-delivery Grab orders in the data.
-- Only completed/ready orders are affected (no cancelled/rejected), so a
-- 'completed' payment is correct for all. amount = order gross (integer cents),
-- matching the live insert. Applied via Supabase MCP 2026-07-03.

INSERT INTO pos_order_payments (order_id, payment_method, provider, amount, provider_ref, status, refund_amount, created_at)
SELECT o.id, 'grabpay', 'grabfood', o.total, o.external_id, 'completed', 0, o.created_at
FROM pos_orders o
LEFT JOIN pos_order_payments p ON p.order_id = o.id
WHERE o.source = 'grabfood' AND p.order_id IS NULL;
