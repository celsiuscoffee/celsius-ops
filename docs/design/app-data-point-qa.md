# App data-point QA — captured-but-not-stored audit

**Owner directive (2026-07-24):** "QA all the data points in the Celsius app;
add to the data warehouse if something is not stored." This is the *data-point*
layer, deeper than the table-level coverage register
(`warehouse-coverage-register.md`): does every data point the apps **collect or
compute** actually land in storage, or is it logged-only / returned-only /
held in memory / sent only to a third party?

Method: six parallel code audits (backoffice APIs, backoffice crons/metrics,
finance crons/agents, customer apps, staff/POS apps, external integrations),
each **grep-verifying** non-persistence before flagging. Findings below are the
verified gaps. Guardrail split: backoffice-only additive changes are buildable
now (rung 1); anything touching **pos-native** (OTA production deploy),
**payments/money**, or a **product decision** is proposed for owner approval.

---

## ✅ BUILT this pass (rung 1 — backoffice, additive)

### Grab per-order commission columns on `pos_orders` (migration 089)
`grab-ingest.ts` computed `merchantChargeFee + serviceChargeFee` at ingest,
folded it into `total`, and dropped the split. Added
`grab_merchant_charge_fee / grab_service_charge_fee / grab_commission_total /
grab_delivery_fee` (sen) and wired both the webhook and reconcile ingest paths.

**Verified caveat that changed the fix:** Grab's webhook/Partner-API price
object sends **both fee fields = 0 for every order** (checked against
`grab_webhook_events.raw`, 947 orders — all zero). The real commission is
**only in the GrabMerchant settlement portal exports**, no received payload
carries it — which is exactly why the GL Grab clearing is rate-derived
(`close-prep.ts`, `exact:false`) and why `grab_ads_spend` is a manual import.
So the wiring treats 0/absent as **NULL (unknown)**, never a false zero, and
the columns populate only if a payload ever carries a real fee. **No backfill**
(raw is all zeros). The genuine fix is a settlement importer — see proposal G1.

---

## 🟠 PROPOSED — money / reconciliation (owner approval)

**G1. Grab settlement importer (the real Grab-commission fix).** Actual
per-order/per-period commission lives only in GrabMerchant settlement report
exports. Recommend a `grab_settlement_lines` table (period, outlet, order_ref,
gross, commission, delivery, net_payout, ads_fee, source_file) imported the
same manual way as `grab_ads_spend`, then reconcile month-end GL 6519 to actuals
instead of rate-derived. Makes `grabPayoutRate` / `exact` real. **HIGH value.**

**G2. Stripe per-transaction processing fees** (`apps/order/.../stripe/webhook`)
— only `payment_provider_ref` is stored; the MDR fee (`balance_transaction.fee`),
charge id, brand, last4, receipt are never fetched, so **card COGS is
understated**. Needs an added Stripe API call (fee isn't in the
`payment_intent.succeeded` payload). Recommend `stripe_payout_lines`
(charge_id, order_id, gross, fee, net, payout_id) — mirrors the working
`RmPayoutLine` pattern. **Payments → human-in-loop.**

**P1. POS discount-override authorization** (`pos-native/app/register.tsx` →
`api/pos/auth/verify-manager`). A manager PIN is verified and the approving
manager resolved, then **thrown away** — the fraud-control audit trail for
manual price cuts. Recommend `pos_discount_overrides` (order_id,
authorized_by_user_id, cashier_id, discount_type, discount_value,
discount_amount_sen, reason). **pos-native + money → owner + OTA release.**

**P2. Dead-lettered offline POS sales + sync telemetry**
(`pos-native/lib/offline-queue.ts`, `sale-sync.ts`). After 5 failed syncs a
completed sale is quarantined **only in on-device AsyncStorage** — silent
revenue loss, no fleet sync-health view. Recommend `pos_sync_failures`
(device/register_id, order_id, outlet_id, attempts, payload, last_error,
quarantined_at) via a service-role endpoint on `quarantine()`. **pos-native →
owner + OTA.**

**P3. Card-terminal reference data** (approvalCode/cardBrand/maskedPan/txnRef;
`pos-native/app/register.tsx`, `maybank-terminal.ts`). Captured + displayed,
only the method string persisted; blocks payout reconciliation
(`RmPayoutLine` matches on `payment_provider_ref`). Terminal is a **stub** today
(synthetic data) so nothing real is lost yet, but the path is missing. Recommend
adding `provider_ref/approval_code/card_brand/masked_pan/txn_ref` to
`pos_order_payments`. **pos-native + payments → owner + OTA.**

---

## 🟡 PROPOSED — analytics / marketing / ops history (rung 1 buildable, batched)

These are backoffice-only additive tables + cron/handler wiring; grouped so the
owner can green-light a batch. None touches money or native apps.

- **client_events + `/api/events` ingest** — the entire customer funnel
  (product_viewed, cart_add, checkout_started/abandoned, payment_cancelled/failed,
  login) routes only to a **no-op Amplitude sink** in `pickup-native`; the web
  `order` build has **no analytics at all**. Cart/checkout-abandonment is
  presently unrecoverable. HIGH for growth analytics. (Wiring the native
  `trackEvent` calls is a native change; the table + web-side ingest are rung 1.)
- **whatsapp status callbacks** — `whatsapp/webhook/route.ts` only `console.log`s
  delivery/read/failed + Meta billing category. Update `WhatsAppMessage` by
  `waMessageId`; add conversation_id/billable/pricing_category.
- **google_reviews** — snapshot cron fetches 50 reviews/outlet, keeps only a
  rollup; positive reviews without a flagged point are discarded. Upsert a
  canonical `google_reviews` table keyed on reviewId.
- **labour_variance_weekly** — the "measure" step of the people-cost loop
  (`cron/labour-variance`) ships only to a WhatsApp digest; actual labour % vs
  plan has zero history.
- **sales_recommendation_run** — the AI sales recs + round/channel/AOV-vs-target
  aggregates (`api/sales/recommendations`) are non-reproducible and discarded
  each load. Mirror the `agent_insights_cache` pattern.
- **ops_scoreboard_weekly** — weekly per-cashier capture/upsell, league rank,
  coaching target, clock-in%/stock-freshness snapshot (`lib/ops-scoreboard`).
- **ads_optimizer_runs** — the Monday shadow-optimizer's reclaimable-waste /
  per-campaign efficiency recommendations are returned as JSON and dropped
  (`cron/ads-optimizer`); `ads_budget_change` records only *applied* changes.
- **fin_sales_recon_snapshots / fin_grab_clearing** — the cash-in recon gap +
  Grab deduction% (`sales-recon.ts`) and the period Grab payout-rate/exact flag
  (`close-prep.ts`) are computed and never snapshotted.
- **supplier_message_signal** — supplier price-increase / SOA announcements over
  WhatsApp (`message-intel.ts`) live only as a JSON annotation + transient count;
  a leading COGS signal with no queryable row.
- **gbp_search_keyword_monthly** — GBP performance search terms: only top-4 kept
  and overwritten each run (`geogrid/keywords.ts`); no monthly time series.
- **menu_search_log / upsell_impressions** — customer menu searches (incl.
  zero-result) and upsell-suggestion impressions/declines aren't stored (only
  *accepted* pairs, via `order_items.is_pair` and `pos_pair_events`).

---

## ✅ Verified CLEAN (persist correctly — no gap)

Revenue Monster settlement (`RmPayoutLine`, incl. mdrFee line-by-line), Bukku
bank feed (`BankStatementLine` + `bukkuId` correlation key), SMS loop sends +
blasts (`loop_assignments.sms_status` / `sms_logs`), WhatsApp inbound
(`WhatsAppMessage.raw`), orders/order_items (notes, pickup_at, discounts, source),
register open/close + shift totals (`pos_shifts`), clock-in geo/photo/OT/roster
+ attendance pings (`hr_attendance_logs` / `hr_attendance_pings`), checklist
items, audit/incident reports, finance ledger/agents (fin_transactions /
fin_journal_lines / fin_agent_decisions / fin_einvoice_submissions /
fin_sst_filings), loyalty loops → campaign_outcomes.

## Out of scope / no live receive-path

BrioHR (skill-based pull to Sheets, no in-repo ingest), Indeed
(`indeed_ads_*` models exist but **no writer** — confirm they're used at all),
Sentry (monitoring via MCP, not warehoused). Base44 + Stripe MCP connectors are
unauthorized in this session (owner authorizes in claude.ai connector settings).

## Guard

Skill **check 32**: re-run this data-point sweep at month-end alongside the
table coverage sweep (check 31). A new POST/webhook/cron that collects or
computes business data must either persist it or be listed here with a verdict.
