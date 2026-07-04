-- Customer refund: money paid back to a customer (a sales return) — an outflow
-- that reduces revenue, distinct from REFUND (a supplier refund coming in).
-- Books to 5002 Customer Refunds, contra-revenue beside 5001 Discount Given.
-- Applied to production 2026-07-04 (supabase migration customer_refund_category).
insert into fin_accounts (code, name, type, parent_code, is_active)
values ('5002', 'Customer Refunds', 'income', '5000', true)
on conflict (code) do nothing;

alter type "CashCategory" add value if not exists 'CUSTOMER_REFUND';
