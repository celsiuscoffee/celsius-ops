// The assistant's curated map of the Celsius database — WHICH tables are
// authoritative for WHICH business questions, and the traps. This is the
// "intelligence" layer: without it the model rediscovers the schema every
// question and falls into known traps (e.g. fin_bank_transactions parses as
// the obvious cash table and is EMPTY; the truth is BankStatement).
//
// Maintained by hand as the schema evolves; injected as a CACHED system block
// so it costs almost nothing per call. Keep it dense and factual — every line
// here saves the model an exploration round.

export const DATA_MAP = `# Celsius data map (authoritative sources + traps)

## Time & money conventions
- Business day is MYT (UTC+8); timestamps are stored UTC. Convert: (col AT TIME ZONE 'Asia/Kuala_Lumpur')::date.
- Checklist.date and similar @db.Date columns hold UTC-midnight of the MYT calendar day — compare with date equality, not ranges.
- Money is DECIMAL in RM. Quote as RM with 2dp.
- Table names are PascalCase and must be double-quoted in SQL ("SalesTransaction"); fin_*/hr_* tables are snake_case.

## Sales & revenue
- unified_sales (VIEW) = the ONLY authoritative sales source: merges own-POS (source='pos_native', live), StoreHub history and consignment. Columns: biz_date (business date, pre-computed — no timezone math needed), outlet_id, outlet_name, gross, discount, sst, nett, tender, channel, status, is_refund.
- Revenue convention: sum(nett) WHERE NOT is_refund AND (status IS NULL OR status <> 'paymentCancelled').
- unified_sale_items (VIEW) = product-level: biz_date, outlet_id, product_name, variant, quantity, unit_price, line_total.
- TRAPS: "SalesTransaction" is a DEAD sync (no rows after 2026-04-11); storehub_sales / hubbo_sales / pos_orders are raw per-source tables already merged into unified_sales — never sum them directly.
- Pickup/QR revenue is recognised at PAYMENT time, not fulfilment.
- TWO REVENUE LENSES (audited 2026-07-12, both correct, different meanings — never mix):
  1. TILL-RUNG sales = unified_sales nett. What the outlets rang up. June 2026: ~RM284k.
  2. BANKED revenue = GL income accounts (fin_journal_lines × fin_accounts type income/revenue): Card + Cash/QR deposits + Grabfood payouts + GastroHub vendor income. Settlement-lagged, SST-inclusive. June 2026: ~RM406k.
  GRAB DELIVERY REVENUE IS NOT IN unified_sales — it only appears in GL/bank (Grabfood account) and the grab_* tables. "Total revenue" questions should say which lens (and mention Grab if using the till lens).
- NILAI IS A CONSIGNMENT OUTLET — no till; its unified_sales rows are all source='consignment' (periodic settlements, latest can lag weeks). Daily-sales questions for Nilai are a category error; it also has 0 ParLevel rows (reorder engine doesn't cover it).
- "orders"/"order_items" (lowercase) = CUSTOMER online orders (pickup app, live). "Order"/"OrderItem" (PascalCase) = procurement purchase orders. Same word, different worlds — pick by context.

## Cash & banking (the trap zone)
- fin_bank_transactions is EMPTY — never use it.
- "BankStatement" = authoritative cash, fed automatically by the Bukku Maybank bank feed (bukku-feed-sync cron, every 6h): one row per statement per company account (accountName, statementDate, closingBalance, totalInflows/Outflows, interCo columns). Latest closingBalance per accountName = cash position. Coverage: the 3 company accounts on the feed are the complete set (owner-confirmed 2026-07-12) — still state the as-of date, since the feed lags up to ~6h+.
- "BankStatementLine" = 50k+ categorised lines: txnDate, amount, direction ('CR' in / 'DR' out), category, isInterCo, expenseMonth. Exclude isInterCo=true for true in/outflows. Use for run-rates, recurring rent/utilities, deposit timing.
- Companies are separate Sdn Bhds per outlet (fin_companies, fin_outlet_companies) — inter-company transfers exist; don't double-count them.

## Payroll & HR
- fin_payroll_actuals = authoritative payroll: period (month date), salary, employer_stat (EPF/SOCSO/EIS), headcount, per outlet/company. ~RM77k/month total lately.
- hr_payroll_runs / hr_payslips are sparse — don't rely on them. BrioHR (external) is the upstream source.
- Roster: hr_schedule_shifts JOIN hr_schedules (only published_at IS NOT NULL counts). Clock-ins: hr_attendance_logs — ADOPTION IS ERRATIC (0-70% of rostered staff actually clock in via the app), so absence of a clock-in is NOT absence of the person.

## Procurement & spend
- "Order" with orderType='PURCHASE_ORDER': statuses DRAFT→PENDING_APPROVAL→APPROVED→SENT→CONFIRMED→AWAITING_DELIVERY→PARTIALLY_RECEIVED→COMPLETED (or CANCELLED). Open/committed spend = statuses before COMPLETED.
- "Invoice" (PascalCase) = the LIVE supplier-invoice table; unpaid = status IN ('PENDING','INITIATED','OVERDUE','PARTIALLY_PAID','DEPOSIT_PAID'). amount is the FULL invoice amount even when PARTIALLY_PAID — remaining balance is not a column.
- TRAPS: fin_invoices and fin_bills are EMPTY (built, never populated) — like fin_bank_transactions, never use them.
- "Supplier".automationMode (OFF|ASSIST|AUTO) = per-supplier agent dial.
- "StockAdjustment" adjustmentType IN ('WASTAGE','BREAKAGE','EXPIRED','SPILLAGE') = wastage; costAmount is estimated cost.

## Ops
- "Checklist": assignedToId semantics matter — unassigned checklists historically complete at 0%; assignment comes from the roster (pre-assign cron) or JIT at overdue time.
- "OpsAlert" = the alert ledger; status RESOLVED can be a bulk human claim ("DONE" reply), not a verified fact.
- "SystemReport" = internal bug/problem queue (OPEN|IN_PROGRESS|RESOLVED|DISMISSED).
- "WhatsAppMessage": direction + type; type='template' outbound ≈ RM0.07 each (billable); free-form in-window is free.

## Loyalty (Supabase-native tables, snake_case)
- member_brands (brand_id='brand-celsius'), redemptions — loyalty membership + redemption activity.

## Metric definitions (use these consistently)
- Labour % = month payroll (salary + employer_stat) / month gross sales.
- Cash runway (days) = total latest closingBalance / avg daily NET outflow from BankStatementLine (28d, isInterCo=false), when net is negative.
- Wastage cost = sum(StockAdjustment.costAmount) over the period.

## Answer discipline for high-stakes questions (cash, payroll, "can we afford X")
- Always state the as-of date of bank statements and the coverage caveat.
- Cross-check with a second source when possible (e.g. balances vs 28d flow trend).
- State assumptions (payday date, which accounts) instead of silently making them.`;
