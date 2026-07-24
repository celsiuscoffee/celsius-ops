# Warehouse coverage register

**Owner directive (2026-07-24):** "this agent should find and make sure all
data is in the data warehouse." This register is the answer to *"is every
material source known, documented, and monitored?"* — a full sweep of the
prod public schema (~230 tables) classified by coverage. Regenerate the
inventory with the query at the bottom; re-run the audit each month-end.

Method: `pg_stat_user_tables.n_live_tup` for scale, then each table with
material data (≥ ~50 live rows, or business-critical config) is given a
verdict. "Documented" = named in `data-map.ts` and/or the `finance-warehouse`
skill with a canonical-source note.

## Verdict summary (2026-07-24 baseline)

| Verdict | Meaning | Count (material) |
| --- | --- | --- |
| ✅ Canonical & documented | Named source with trap notes | ~40 |
| 🔵 Covered via parent | Child/detail of a documented table | ~15 |
| 🟡 GAP → now documented | Was undocumented; added to data-map this pass | 9 clusters |
| ⚪ Derived / cache / config | Not a warehouse source; fine undocumented | ~25 |
| 🗑️ Debris | Backup / quarantine / deleted-snapshot tables | 12 |
| 🚫 Built-empty zombie | Table exists, never populated (known trap) | ~15 |

## 🟡 Gaps closed this pass (added to data-map 2026-07-24)

These held **material, live** business data with **no home** in the warehouse
contract. Now documented:

1. **Grab commission** — expense account `6519` Merchant fees via monthly
   `grab_clearing` journals (June ≈ RM14.6k); the wedge between gross Grab
   income (5000-04) and the 1005 payout. Previously invisible as a cost.
2. **grab_ads_spend** — manual marketing metric (~RM13.7k Mar–Jul); TRAP: it
   is *inside* 6519 already ("billed in payouts") — never double-count. Feed
   is manual and July already lags.
3. **grab_webhook_events / grab_reconcile_runs** — live Grab order pipeline
   (operational, not a revenue source).
4. **ads_search_term_daily** (~34k rows, fresh daily) + **ads_metric_daily**,
   **ads_campaign**, **ads_budget_change**, **ads_term_exclusion**,
   **ads_payment** — the Google Ads subsystem. Real marketing spend, tracked
   here but NOT reconciled into the GL. Quote ad spend from ads_metric_daily.
5. **consignment_sales** (~2.2k) — raw consignment settlements feeding the
   `consignment` source of unified_sales; settlements lag weeks.
6. **fin_documents** (~17k) — ingested source-doc evidence layer for
   categorization/AP.
7. **fin_fixed_assets** (61) — the only home for capex/depreciation.
8. **RecurringExpense** (8 active) — recurring-cost cadence for cash forecasting.
9. **jkk_dashboard_stats** (~8.4k, fresh, 11 metric keys, `modelled` flag) —
   an internal dashboard-stats *cache*, NOT a source; classified ⚪ so no one
   mistakes it for canonical (it can be modelled/synthetic).

## ✅ Canonical & documented (the backbone)

Sales: unified_sales / unified_sale_items (over storehub_*, hubbo_*,
pos_orders/pos_order_items, orders/order_items, consignment_sales). Cash:
BankStatement / BankStatementLine. GL: fin_transactions / fin_journal_lines /
fin_accounts / fin_periods / fin_companies. Payroll: fin_payroll_actuals,
hr_payroll_runs/items. Procurement: Order/OrderItem, Invoice, Receiving,
StockBalance, StockAdjustment, ParLevel, StockCount, Supplier. Unit econ:
product_costs / menu_margins / MenuIngredient / ProductPackage. Loyalty sends:
loop_assignments, loop_rounds, campaign_outcomes. Ops: Checklist, OpsAlert,
AuditReport, WhatsAppMessage. Reviews/geo: ReviewDailySnapshot, GeoGridScan.
Substrate: agent_registry, agent_actions. (See data-map.ts + skill for the
per-table trap notes.)

## 🔵 Covered via parent (child/detail — implicitly in scope)

storehub_sale_items, hubbo_sale_items, pos_order_items, pos_order_payments →
sales views. ReceivingItem → Receiving. StockCountItem → StockCount.
StockTransfer/StockTransferItem → inventory. AuditReportItem → AuditReport.
ChecklistItem → Checklist. hr_schedule_shift_audit, hr_attendance_pings,
hr_overtime_requests → roster/attendance. issued_rewards, point_transactions,
redemptions, members → loyalty (member_brands is the documented head).

## ⚪ Derived / cache / config (not warehouse sources)

jkk_* (dashboard cache — may be modelled), agent_insights_cache,
agent_messages, agent_prompts, hr_agent_runs, fin_agent_decisions (finance
eval set — see finance-module skill), fin_category_hints, fin_bank_line_events,
consumption_shadow_runs, outlet_product_availability, SupplierProduct,
product_co_purchase_seed / product_round_seed, categories, storehub_products,
products, Product, ShortLink, otp_codes, rate_limits, expo_push_tokens,
app_settings, ActivityLog, splash_posters, pos_poster_perf, pos_pair_events,
pos_shifts, mystery_drops / mission_assignments / challenge_nudge_assignment /
reward_missions / user_streaks / voucher_templates / tiers / promotions /
promotion_applications (loyalty gamification engine — operational), SalesTarget.

## 🗑️ Debris — recommend cleanup (housekeeping skill)

Backup/quarantine/deleted snapshots left in the public schema:
`pos_order_items_backup_20260606`, `pos_orders_backup_20260606`,
`pos_order_payments_backup_20260606`, `pos_shifts_backup_20260606`,
`pos_pair_events_backup_20260606`, `loop_assignments_quarantine_20260624`,
`member_brands_adj_20260615`, `member_brands_adj_20260606`,
`point_txn_deleted_20260615`, `point_txn_deleted_20260606`, `_outlets_backup`,
`_outlet_settings_backup`. None are read by app code (verify before drop).
Owner decision — propose-only (rung 3).

## 🚫 Built-empty zombies (known traps — never use)

fin_bank_transactions, fin_invoices, fin_bills, fin_matches, fin_exceptions,
fin_einvoice_submissions, fin_bank_recons, sms_credits, SalesTransaction (dead
sync), plus many empty hr_* statutory-config and music_* tables (feature scaffolds).

## Regenerate the inventory

```sql
SELECT c.relname AS tbl, s.n_live_tup AS live_rows,
       greatest(s.last_analyze, s.last_autoanalyze)::date AS last_analyze
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
WHERE n.nspname='public' AND c.relkind='r'
ORDER BY s.n_live_tup DESC NULLS LAST;
```

Then diff material tables (live_rows ≥ 50) against tables named in
`data-map.ts` + the skill. Any new material table with no verdict here is a
coverage gap — classify it (check 31).
