-- Supplier refunds / return credits land as bank inflows; REFUND posts against 6000-01
-- (money back reduces COGS). Applied to production 2026-07-02 (supabase migration cashcategory_refund).
alter type "CashCategory" add value if not exists 'REFUND';
