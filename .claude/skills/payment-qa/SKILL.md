---
name: payment-qa
description: Payment-pipeline QA sweep for QR/pickup ordering (Revenue Monster + Stripe). Use when asked to check payments, when the scheduled payment-QA routine fires, or after any payment-related deploy. Triages every payment failure into customer-abandonment / gateway-side / our-defect, drives our-side defects to zero, and escalates gateway problems with evidence.
---

# Payment QA — target: 0 failures that are our fault

The standing goal: **no customer who tries to pay is failed by OUR system.**
Genuine customer walk-aways are acceptable (tracked). Gateway-side problems
(Revenue Monster outages/timeouts) are not ours to fix but must never pass
silently — they get escalated with evidence the same hour.

Context from the 2026-07-19 incident this skill encodes: RM webhooks failed
signature verification for weeks (PKCS#1 key vs SPKI parser — fixed in #998),
so payment confirmation silently depended on reconcile crons re-querying an
RM API that times out under load. Customers paid at the bank and got no
order. The sweep below is designed to catch every link in that chain.

## Data sources

- **Supabase** (project `kqdcdhpnyuwrxqhbuyfl`): `orders` (QR/pickup),
  `pos_orders` (POS/Grab counter sales).
- **Vercel runtime logs**: project `prj_pA8a6tDFV7V2CLoQGCmflvJCYi9n`
  (celsius-pickup-app), team `team_MbZi5UsM8IQ2fJRWdVgaTDMS`.
- Store slugs: shah-alam, conezion, tamarind (POS ids outlet-sa/-con/-tam).

## The sweep (run every invocation)

1. **Stuck orders** — `orders.status='pending'` older than 15 min. The
   expire/reconcile crons must have settled these; any survivor means the
   crons are failing → pull `/api/cron/reconcile-pending` +
   `/api/cron/expire-orders` logs and diagnose.
2. **Failure ledger since the last run** — every `status='failed'` order,
   with `payment_failure_reason`, method, store. Classify EACH:
   - `abandoned_unpaid` (never reached RM checkout) → customer walk-away. OK.
   - `rm_expired`/`rm_cancelled`/`rm_failed` WITH a completed retry by the
     same table/phone within ~15 min → recovered; count but OK.
   - `rm_expired` with NO recovery → lost customer. Investigate: webhook
     health (step 3) and RM latency (step 4) decide whose fault.
3. **Webhook health** — logs for `POST /api/payments/webhook`: any
   `sig verify threw`, `signature did not verify`, non-2xx, or
   `[rmkey] parsed=FAILED` → OUR defect, fix path below. Silence in logs +
   `parsed=rsa` at boot = healthy.
4. **Gateway health** — `TimeoutError` on RM queries, RM 5xx, or webhook
   gaps while payments were initiated → GATEWAY-side. Do not "fix" our code
   for this; collect timestamps/order numbers into an escalation note.
5. **Paid-but-failed invariant** — `payment_provider_ref IS NOT NULL AND
   status='failed'`: must be ZERO rows ever (money-received-wins invariant).
   Any hit is a P1 our-defect.
6. **Double-charge sweep** — failed QR order + POS counter sale, same
   outlet, same total, within 20 min after → candidate list for manual RM
   portal check. Report, don't refund automatically.
7. **Method scorecard** — per method: completed vs rm_expired rate for the
   window and trailing 7 days. Healthy baseline is FPX ≈ 4%. A method
   persistently >3× baseline after webhook health is confirmed → recommend
   disabling it in `payment_gateway_config` (a DB toggle — but ASK the
   owner first; removing a payment method is a business decision).

## Actions by classification

- **Our defect, small + safe** (config, key parsing, log-only): fix on a
  `hotfix/*` branch off `main`, typecheck, open a PR, and ASK the owner
  before merging (merging deploys to production).
- **Our defect, large/ambiguous**: write up the diagnosis with file:line
  references and notify the owner — do not attempt a live refactor.
- **Gateway-side**: assemble the evidence block (UTC timestamps, order
  numbers, RM refs, error text) formatted for an RM support ticket, and
  notify the owner. Never silently absorb a gateway failure.
- **All healthy**: end quietly. No noise.

## Notify the owner when (and only when)

- Any stuck order, paid-but-failed hit, or our-defect found.
- Gateway failure spike (≥3 gateway-attributed failures in the window).
- A method breaches the 3× baseline rule with a disable recommendation.
