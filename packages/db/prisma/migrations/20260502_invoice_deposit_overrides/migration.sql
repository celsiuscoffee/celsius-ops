-- Move deposit-percent + terms from supplier-only to per-invoice. Supplier
-- values stay as smart defaults (auto-fill on invoice creation), but the
-- invoice can override them — useful when a single supplier has mixed
-- deposit/no-deposit POs (e.g. trial orders, follow-ups, etc).
--
-- depositAmount / depositPaidAt / depositRef already exist; we just add
-- the percent + terms beside them so the math + due-date calc can run from
-- invoice fields without touching the supplier table.
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "depositPercent" INTEGER,
  ADD COLUMN IF NOT EXISTS "depositTermsDays" INTEGER;
