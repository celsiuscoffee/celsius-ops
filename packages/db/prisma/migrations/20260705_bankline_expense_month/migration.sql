-- Per-line expense-month override for accrual P&L recognition: first day of
-- the month the payment's expense belongs to. Null = derive from the category
-- shift map / matched invoice / cash date. Cash Flow and GL stay cash-dated.
ALTER TABLE "BankStatementLine" ADD COLUMN IF NOT EXISTS "expenseMonth" DATE;
