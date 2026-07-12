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
- "SalesTransaction" = authoritative sales (StoreHub-sourced): transactedAt (UTC), grossAmount, quantity, menuName, outletId.
- storehub_sales / storehub_sale_items = raw sync staging — do NOT sum these for revenue.
- Pickup/QR revenue is recognised at PAYMENT time, not fulfilment.

## Cash & banking (the trap zone)
- fin_bank_transactions is EMPTY — never use it.
- "BankStatement" = authoritative cash: one row per uploaded statement per company account (accountName, statementDate, closingBalance, totalInflows/Outflows, interCo columns). Latest closingBalance per accountName = cash position. COVERAGE CAVEAT: only accounts someone uploads are present — say "across the uploaded accounts, as of <date>".
- "BankStatementLine" = 50k+ categorised lines: txnDate, amount, direction ('CR' in / 'DR' out), category, isInterCo, expenseMonth. Exclude isInterCo=true for true in/outflows. Use for run-rates, recurring rent/utilities, deposit timing.
- Companies are separate Sdn Bhds per outlet (fin_companies, fin_outlet_companies) — inter-company transfers exist; don't double-count them.

## Payroll & HR
- fin_payroll_actuals = authoritative payroll: period (month date), salary, employer_stat (EPF/SOCSO/EIS), headcount, per outlet/company. ~RM77k/month total lately.
- hr_payroll_runs / hr_payslips are sparse — don't rely on them. BrioHR (external) is the upstream source.
- Roster: hr_schedule_shifts JOIN hr_schedules (only published_at IS NOT NULL counts). Clock-ins: hr_attendance_logs — ADOPTION IS ERRATIC (0-70% of rostered staff actually clock in via the app), so absence of a clock-in is NOT absence of the person.

## Procurement & spend
- "Order" with orderType='PURCHASE_ORDER': statuses DRAFT→PENDING_APPROVAL→APPROVED→SENT→CONFIRMED→AWAITING_DELIVERY→PARTIALLY_RECEIVED→COMPLETED (or CANCELLED). Open/committed spend = statuses before COMPLETED.
- "Invoice" = supplier invoices; unpaid = status IN ('PENDING','INITIATED','OVERDUE','PARTIALLY_PAID','DEPOSIT_PAID'). amount is the FULL invoice amount even when PARTIALLY_PAID — remaining balance is not a column.
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
