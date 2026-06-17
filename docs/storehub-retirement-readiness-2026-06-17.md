# StoreHub Retirement & Tamarind Cutover — Readiness Report

**Date:** 2026-06-17 · **Tamarind cutover:** 2026-06-18 (tomorrow) · **StoreHub cancellation target:** 2026-06-27
**Scope:** Final outlet (Tamarind / `outlet-tam`) moves off StoreHub onto POS-native, after which StoreHub can be fully retired. Verified live against Supabase `kqdcdhpnyuwrxqhbuyfl` (main ops DB) + code audit on this branch.

---

## Verdict

**Tamarind can cut over tomorrow — the native path is already proven on Putrajaya (cut over Jun 8) and Shah Alam (cut over Jun 15), both ringing real-time `pos_orders` today.** The 3 cancellation blockers are now largely closed in code (see the status update below); the cutover itself remains a 6-item operational checklist. The 9-day buffer (Jun 18→27) is enough to deploy + verify.

---

## Update — 2026-06-17 (implementation)

Decisions confirmed by owner + work done this session:

- **C3 Beep → resolved (no code).** Beep is already replaced by the Celsius App, so its orders now land in the `orders` table, not StoreHub. Only operational step left: retire the StoreHub Beep storefront link/QR so no customer hits a dead Beep page.
- **C1 Finance → built.** New `pos-native-eod.ts` ingestor posts the daily AR journal from `pos_orders` (+ `pos_order_payments`) **and** the pickup `orders` table (where former-Beep revenue lives). `finance-eod` now routes per outlet by cutover (`ingestEodForDate`): native on/after cutover, StoreHub before. Validated against Putrajaya 2026-06-16 (95 till txns RM2,755.58 + 13 app orders ≈ RM489, tenders mapped correctly). **Pending: deploy + watch the first native run (4 AM MYT) reconcile to the dashboard before the 27th.**
- **C2 Sales double-count → fixed.** `unified-sales` + staff `storehub-bridge` now count StoreHub for days *strictly before* cutover only; the live "today" pull is gated to still-pre-cutover outlets. No more `OFFLINE_PAYMENTS`/`GRABFOOD` post-cutover double-count.
- **Housekeeping done:** integrations UI shows StoreHub as *Retired / archive-only* (+ "Tamarind Square"→"Tamarind", added Nilai); `.env.example` marks `STOREHUB_*` legacy; dropped the 3 orphan `*_test_del_20260615` tables.
- **Housekeeping deferred (on purpose):**
  - **`storehub-sync` cron** — keep until the 27th. Tamarind is on StoreHub until tomorrow and con/sa still have a small Grab tail; the archive (used for pre-cutover history) must stay fresh. Remove the entry from `apps/backoffice/vercel.json` at cancellation.
  - **`*_backup_20260606` + `_outlets_backup` / `_outlet_settings_backup`** — kept. These are cutover safety snapshots; dropping them while the migration is still in flight is the wrong call. Drop after the 27th once validated.
  - **Par-levels repoint — blocked on a mapping.** `inventory/par-levels/calculate` reads `SalesTransaction.menuId`; the only catalogue link is `Menu.storehubId`, and there is no `pos_order_items.product_id → menuId` path. Needs a POS-product↔inventory-menu mapping before it can be repointed. Until then par-levels go stale after the StoreHub `sync-sales` stops.
  - **Loyalty StoreHub endpoints — still UI-wired, not orphaned.** `/api/storehub/match` (button in `apps/loyalty staff/page.tsx:563`), `/api/storehub/test` (`admin/settings/page.tsx:117`), and `dashboard/kpi` (`fetchTransactionCount`) all still reference `lib/storehub.ts`. Accrual is native, so they're harmless, but "retiring" them means removing those UI surfaces too — a small loyalty-app task, not a one-liner.

---

## A. Live state (verified in DB, 2026-06-17)

| Outlet | id | StoreHub | `posNativeCutoverAt` | Native orders / 30d | StoreHub rows / last 3d |
|---|---|---|---|---|---|
| Putrajaya | `outlet-con` | linked | **2026-06-07 16:00Z** (Jun 8 MYT) | 1,039 (293 in 3d) | 2,666 → only 5 |
| Shah Alam | `outlet-sa` | linked | **2026-06-14 16:00Z** (Jun 15 MYT) | 268 (all in 3d) | 3,070 → 22 |
| **Tamarind** | **`outlet-tam`** | **linked** | **NULL — still on StoreHub** | **0** | **2,924 → 302 (≈100/day, last txn today)** |
| Nilai | `outlet-nilai` | none | NULL | 0 | — (never on StoreHub) |
| IOI Mall | — | none | — | — | INACTIVE (closed) |

- StoreHub `channel` is always one of three: `OFFLINE_PAYMENTS` (in-store till, ~6.8k/30d), `BEEP_ORDERS` (StoreHub online storefront, ~1.1k/30d), `GRABFOOD` (~0.8k/30d).
- Native GrabFood is **already live** — `pos_orders.source='grabfood'` for con (10) and sa (9), last orders today. Tamarind is **not** Grab-linked natively yet.
- Nilai has no StoreHub link and 0 native orders in 30d — confirm it's pre-launch, not a dead till (not a StoreHub-retirement concern either way).

---

## B. Tamarind cutover — do before/at go-live (Jun 18)

1. **Set the cutover timestamp.** `UPDATE "Outlet" SET "posNativeCutoverAt" = '2026-06-17 16:00:00+00' WHERE id = 'outlet-tam';` (= midnight Jun 18 MYT, mirroring the con/sa pattern). This is the switch that makes the sales dashboard read `pos_orders` for Tamarind and stop counting StoreHub till rows.
2. **Link Tamarind to native GrabFood** (set its `grabMerchantId` on the integrations/grab page) so Grab inbound lands in `pos_orders`. Today Tamarind's Grab still flows only through StoreHub — if it isn't moved, Grab orders vanish on the 27th.
3. **Verify the native catalogue for Tamarind** — products, prices, modifiers, categories. StoreHub was the declared "source of truth for product catalog"; confirm parity in the native POS and print a test receipt with the correct legal identity (`companyName` / `regNo` / SSM).
4. **Verify payments for the `tamarind` store** — Revenue Monster creds, enabled methods, and the Maybank QR poster image (integrations page) all configured.
5. **Hardware + staff** — register/printer paired (`network-printer`), `staffPin`s set, staff briefed.
6. **Stop ringing sales into the StoreHub till at cutover.** Any in-store sale put through StoreHub after the cutover timestamp is tagged `OFFLINE_PAYMENTS` and will **double-count** against `pos_orders` (see C2).

---

## C. Blockers before cancelling StoreHub (27th)

**C1 — Daily finance/AR posting is StoreHub-only. (highest priority)**
The `finance-eod` cron (`0 20 * * *` = 4 AM MYT) → `storehub-eod.ts` ingestor is the *only* path that posts daily revenue AR journals, and it reads exclusively from the StoreHub API for outlets with a `storehubId`. There is **no `pos_orders` ingestor** (`lib/finance/ingestors/` contains only `storehub-eod.ts`). On the 27th, AR/EOD posting stops for **every** outlet, not just Tamarind. Options: (a) build a native EOD ingestor that aggregates `pos_orders` + `orders` (pickup) + native Grab into the same `EodSummary` → `postDailyAr`; (b) keep StoreHub alive solely for finance a bit longer; or (c) accept manual revenue journals in the interim. (a) is the clean fix and fits the 9-day buffer.

**C2 — Sales dashboard double-counts post-cutover StoreHub rows. (verified bug)**
The cutover de-dup (in `unified-sales.ts` and the staff `storehub-bridge.ts`) keeps post-cutover StoreHub rows *"only if they carry a channel"*, on the assumption that till sales have no channel. **That assumption is false** — StoreHub tags till sales `OFFLINE_PAYMENTS`. Verified: 6 post-cutover `OFFLINE_PAYMENTS` rows for Putrajaya (RM140) are counted *on top of* `pos_orders`. Worse, now that Grab is native, post-cutover `GRABFOOD` StoreHub rows (65 for con) also duplicate the native `grabfood` `pos_orders`. Fix the filter to keep only channels with **no** native equivalent (today that's just `BEEP_ORDERS`), not "any channel". Note: once StoreHub is cancelled and `storehub-sync` stops, this self-resolves going *forward*, but the June overlap days are overstated and may want a correction.

**C3 — Beep online ordering has no native replacement.**
`BEEP_ORDERS` is StoreHub's own customer storefront (~1.1k orders/30d). Killing StoreHub kills Beep. Before the 27th: route those customers to the pickup/order app (`orders` table), swap any Beep links/QR codes/Google-profile "order online" URLs, and tell regulars. Otherwise that demand disappears with no fallback.

---

## D. Housekeeping (at / after the 27th)

- **Crons:** remove `storehub-sync` (`apps/backoffice/vercel.json`, hourly) once cancelled — it will otherwise throw a caught 401 every hour for every linked outlet. **Keep the `storehub_sales` archive** — it's the historical sales record. Also guard the StoreHub branch of `finance-eod` so it doesn't error nightly.
- **Inventory:** `inventory/par-levels/calculate` reads `SalesTransaction`, which is fed *only* by `inventory/storehub/sync-sales` (live StoreHub API). After cancellation, par-level / depletion recommendations go stale — repoint to native `pos_order_items`.
- **Loyalty:** in-store accrual is already native (`/api/pos/loyalty/complete` + the `pos-loyalty-reconcile` safety-net cron writing Beans + mystery drops from `pos_orders`). The legacy StoreHub points matcher (`apps/loyalty /api/storehub/{match,compare,test}` + `lib/storehub.ts`) is **dormant — not on any cron** — so it's safe to retire, not a blocker.
- **Product catalog:** flip "source of truth" from StoreHub to the native catalogue. The integrations page hardcodes a "StoreHub · Connected / Active · syncing" pill and "source of truth for product catalog and sales" copy — update it. `storehub_products` + the `StorehubSync` table become archival.
- **Secrets:** keep `STOREHUB_ACCOUNT_ID` / `STOREHUB_API_KEY` / `STOREHUB_USERNAME` until fully retired, then remove from Vercel (backoffice **and** loyalty) and `.env.example`. (Backoffice uses `STOREHUB_ACCOUNT_ID`, loyalty uses `STOREHUB_USERNAME` for the same value — collapse to one.)
- **Temp tables:** drop the leftovers when convenient — `pos_orders_test_del_20260615`, `pos_order_items_test_del_20260615`, `pos_order_payments_test_del_20260615`, `*_backup_20260606`, `_outlets_backup`, `_outlet_settings_backup`.
- **Label drift:** integrations `STORE_NAMES` says "Tamarind Square" (standard is "Tamarind") and omits Nilai.

## D2. Before you lose StoreHub access (do by ~Jun 26)

- **Export everything you'll ever want from StoreHub** while the account is live: full transaction history (CSV), product catalogue **with costs**, inventory/stock counts, and settlement/payout statements. Portal access usually dies with the subscription.
- **Confirm cancellation terms** with StoreHub: notice period (some require 30 days), whether billing stops immediately or at cycle end, hardware return/buyout, and any **final settlement payout** of Beep/Grab money StoreHub is holding on your behalf.
- **Grab handover:** if your Grab merchant link was provisioned *through* StoreHub, make sure moving Grab to the native integration doesn't disconnect the Grab store when StoreHub is removed — verify native Grab keeps receiving orders for a day before pulling the StoreHub plug.
- **Run the final `finance-eod`** for the last StoreHub trading day (25th/26th) and confirm it posted before access lapses.

---

## E. Verified safe / already native (don't re-litigate)

Till → `pos_orders` real-time (con/sa live today); in-store loyalty Beans + mystery drops native + reconciled; GrabFood inbound native for con/sa (orders today); native + unified sales dashboards exist and the archive is retained for history; payments native (Revenue Monster / Stripe / Maybank QR). Tamarind is the only remaining StoreHub-dependent till.

---

## F. Recommended sequence

1. **Today:** set Tamarind `posNativeCutoverAt` = `2026-06-17 16:00Z`; link Tamarind native Grab; verify catalogue / payments / printers (§B).
2. **Jun 18:** Tamarind live; staff stop using the StoreHub till; watch `pos_orders` flow and catch any stray `OFFLINE_PAYMENTS` still hitting StoreHub.
3. **Jun 18–26 (buffer):** ship native finance-EOD ingestor (C1); fix the de-dup filter (C2); stand up the Beep redirect (C3); repoint inventory par-levels (D).
4. **~Jun 26:** export StoreHub data/reports; confirm cancellation terms + final settlement; run/confirm the last StoreHub EOD (§D2).
5. **Jun 27:** cancel StoreHub; remove `storehub-sync`, guard `finance-eod`'s StoreHub branch, flip the integrations UI.
6. **After:** remove secrets, retire the dormant loyalty StoreHub endpoints, drop the temp tables.
