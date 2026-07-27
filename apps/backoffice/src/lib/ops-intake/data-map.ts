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
- The sst column is DEAD — all-zero for every source since inception (verified 2026-07-17). nett is the amount as rung; never compute SST from unified_sales — SST lives only in the GL/filing side.
- unified_sale_items (VIEW) = product-level: biz_date, outlet_id, product_name, variant, quantity, unit_price, line_total.
- TRAPS: "SalesTransaction" is a DEAD sync (no rows after 2026-04-11); storehub_sales / hubbo_sales / pos_orders are raw per-source tables already merged into unified_sales — never sum them directly.
- Pickup/QR revenue is recognised at PAYMENT time, not fulfilment.
- TWO REVENUE LENSES (re-verified 2026-07-17 — the GL lens CHANGED SEMANTICS at the POS cutover):
  1. SALES lens = unified_sales nett. Since 2026-07-17 the view INCLUDES the pickup app (source/channel='pickup', paid statuses baked in) — it is now genuinely complete: pos + grabfood + pickup + consignment.
  2. GL income (fin_journal_lines × fin_accounts type income/revenue). Since the pos_native cutover (fully from ~Jun 18) accounts 5000-01/02/04 are fed by DAILY EOD JOURNALS from the till — accrual at ring-up, NOT bank settlements. Verified Jul 1–14: GL EOD income = unified_sales(pos+grabfood) + pickup-app orders, to within RM48. Bank-fed income remains only for 5000-09 GastroHub / 5000-10 events. Grab DELIVERY payouts now post to 1005 (transit), not income.
  So today: GL income ≈ unified_sales(pos+grabfood+pickup channels) + GastroHub/events; consignment is in the view but NOT in EOD income. Pre-cutover months the GL lens was bank-settlement-fed (lagged, SST-inclusive); GRAB DELIVERY REVENUE only ever appeared in that bank lens / grab_* tables.
  JUNE 2026 IS MIXED-REGIME AND SUSPECT: bank-fed income posted through Jun 17 WHILE EOD journals ran from Jun 6 — up to RM81k of June GL income may be double-counted (unwind pending; period still open). Do not quote June GL income without this caveat.
- NILAI IS A CONSIGNMENT OUTLET — no till; its unified_sales rows are all source='consignment' (periodic settlements, latest can lag weeks). Daily-sales questions for Nilai are a category error; it also has 0 ParLevel rows (reorder engine doesn't cover it).
- "orders"/"order_items" (lowercase) = CUSTOMER online orders (pickup app, live; ~RM40k/month). Paid rows are IN unified_sales since 2026-07-17 (source='pickup') — do NOT add orders on top of the view or you double-count. Raw money columns are in SEN (divide by 100); the view already converts. Paid set: status IN ('paid','preparing','ready','collected','completed'). unified_sale_items does NOT yet carry pickup item lines. "Order"/"OrderItem" (PascalCase) = procurement purchase orders. Same word, different worlds — pick by context.

## Cash & banking (the trap zone)
- fin_bank_transactions is EMPTY — never use it.
- "BankStatement" = authoritative cash, fed automatically by the Bukku Maybank bank feed (bukku-feed-sync cron, every 6h): one row per statement per company account (accountName, statementDate, closingBalance, totalInflows/Outflows, interCo columns). Latest closingBalance per accountName = cash position. Coverage: the 3 company accounts on the feed are the complete set (owner-confirmed 2026-07-12) — still state the as-of date, since the feed lags up to ~6h+.
- "BankStatementLine" = 50k+ categorised lines: txnDate, amount, direction ('CR' in / 'DR' out), category, isInterCo, expenseMonth. Exclude isInterCo=true for true in/outflows. Use for run-rates, recurring rent/utilities, deposit timing.
- Companies are separate Sdn Bhds per outlet (fin_companies, fin_outlet_companies) — inter-company transfers exist; don't double-count them.
- fin_inventory_valuations = manual COGS boundary anchors per outlet (e.g. Bukku Q1 close); the COGS engine prefers a row here over a stock count when it sits closer to the period boundary. Currently EMPTY (no anchors entered yet).

## Unit economics (views, since 2026-07-18)
- product_costs (VIEW) = cost per BASE unit (g/ml/pcs) per ingredient: avg of last 5 received PO lines (OrderItem.unitPrice ÷ ProductPackage.conversionFactor), manual override via product_cost_overrides. costed_via IN ('derived','manual','uncosted').
- menu_margins (VIEW) = margin per menu item: Menu.sellingPrice − channel-weighted recipe cost (MenuIngredient × product_costs). ALWAYS quote uncosted_ingredients — a margin with uncosted>0 is overstated. Packaging cost NOT included (v1).
- Recipes: "MenuIngredient" (92/92 menus covered). Consumption engine (shadow) = sales × recipes; its cron summary carries itemsUnmapped.

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
