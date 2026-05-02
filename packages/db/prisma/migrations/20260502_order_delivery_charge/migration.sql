-- Persist the supplier's delivery charge on the Order itself, so PO totals
-- match what's actually owed (items + delivery), not just the line items.
-- Was previously only added to Invoice.amount, leaving Order.totalAmount
-- understated on the PO list. Defaulting to 0 keeps existing rows and
-- aggregations intact.
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "deliveryCharge" DECIMAL(65,30) NOT NULL DEFAULT 0;
