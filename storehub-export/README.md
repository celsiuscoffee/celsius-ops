# StoreHub data export — saved 2026-06-18

Snapshot of Celsius's StoreHub data, exported before the StoreHub subscription
is cancelled (target 2026-06-27). Generated from the in-DB archive
(`storehub_*` tables in the main Supabase project), which is itself a faithful
copy of StoreHub and **survives cancellation**.

## Files
- **`products-with-costs.csv`** — full product catalogue (102 items): name, SKU, category, selling price, and unit cost where StoreHub had it.
- **`monthly-sales-by-outlet-channel.csv`** — every month × outlet × channel (Aug 2025 → Jun 2026): order count + net revenue. Channels: `OFFLINE_PAYMENTS` (in-store till), `GRABFOOD`, `BEEP_ORDERS` (StoreHub online storefront).
- **`monthly-item-sales.csv`** — every month × product: units sold + net revenue (company-wide).

## What's NOT in these files (and where to get it)
- **Full transaction-level history** (67,535 transactions, each with its raw payload) lives permanently in `storehub_sales` and **`storehub_sale_items`** (126k+ line items, complete Aug 2025 → Jun 17 2026). It survives StoreHub cancellation. For a one-shot CSV dump, use the Supabase dashboard → Table Editor → `storehub_sales` / `storehub_sale_items` → Export to CSV (or `pg_dump`/`\copy` with the DB password).
- **Portal-only artifacts** StoreHub holds that are NOT in our DB — settlement/payout statements, StoreHub-side stock counts, and any customer/member list — must be exported from the StoreHub BackOffice while the account is live. See `docs/storehub-export-checklist.md`.

Revenue figures are net (StoreHub `total`), MYT calendar months.
