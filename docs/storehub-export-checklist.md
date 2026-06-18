# StoreHub Export Checklist — before cancelling (~2026-06-26)

Portal access dies with the subscription. Grab everything below first. Good
news: **most of it is already in our own DB** (main Supabase project) and
survives cancellation — only the bottom section is portal-only and must be
exported manually.

## Already owned in-DB — nothing to do (verify, don't re-export)

| Data | Where | Coverage |
|---|---|---|
| Every transaction (full raw payload) | `storehub_sales.raw` | 2025-08-29 → 2026-06-17, 67,535 rows, 100% with raw |
| Line items (per-product) | `storehub_sale_items` | 2025-08-29 → 2026-06-17 — **gap Jun 9–17 rebuilt from `raw` on 2026-06-18**, complete |
| Product catalogue **with cost** | `storehub_products` | 102 items (cost, unit_price, sku, barcode, category, raw) |
| Daily EOD blobs (AR provenance) | `fin_documents` where `source='storehub'` | through each outlet's cutover |

These are now the permanent system-of-record archive. **Do not drop the
`storehub_*` tables.**

## Portal-only — export manually from StoreHub BackOffice before cancelling

- [ ] **Settlement / payout statements** — Grab, Beep, card, e-wallet payouts. The final settlement (money StoreHub still holds on your behalf) won't appear in our DB. Export every statement + note the final payout date.
- [ ] **Inventory / stock** — StoreHub-side stock levels, stock counts, stock-take history, and supplier/purchase records if you kept them there (our inventory is separate, but reconcile opening balances).
- [ ] **Customers / members** — if StoreHub loyalty/CRM was used, export the member list + balances (our loyalty is native, but capture anything historical).
- [ ] **Tax / financial reports** — monthly sales, SST, and any reports your accountant relies on, as PDF/CSV, for the full StoreHub period.
- [ ] **Employees / timesheets** — only if anything lived in StoreHub (HR is on the native module, so likely nothing).
- [ ] **Final product-cost snapshot** — re-run the product sync once more (or export the product list) so `storehub_products` has the latest costs at cancellation.

## Account / commercial — confirm with StoreHub

- [ ] Cancellation notice period (some require 30 days) and whether billing stops immediately or at cycle end.
- [ ] Hardware return / buyout terms.
- [ ] Final settlement payout cleared to the bank before access is cut.
- [ ] Grab handover: confirm native GrabFood keeps receiving orders for a day before StoreHub is disconnected (so the Grab store link isn't dropped with StoreHub).
