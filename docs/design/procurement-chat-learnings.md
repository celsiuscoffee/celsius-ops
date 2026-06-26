# Procurement — what 17 real supplier chats taught us

_Analysis of 17 WhatsApp exports (32,709 lines, 4,256 attachments), Jun 2022 → Jun 2026.
Suppliers: JG Pacific, Cake Discovery, Unique, JS Breadserie, Blancoz, Dankoff, BeansCo,
Yow Seng, Collective, Milk Moka/Farm Fresh, Jiju's, BGS, BBM, GCR, Xora, RICH's, HNJ._

## The single most important finding
Celsius has **already built the content-generation** for procurement — it shows up in
EVERY chat from ~May 2026:
- A structured **`📋 Order from Celsius Coffee`** per-outlet order block
  (generated in `inventory/orders/create`, `staff-native/orders/new`).
- An automated **POP message** — *"payment has been made for invoice {inv} — RM {amt}.
  Ref: {ref}. Receipt: https://payment.celsiuscoffee.com/r/…/POP_{inv}_{supplier}_RM{amt}.pdf"*
  (generated in `staff-native/lib/ops/invoices.ts` + `lib/shortlink.ts` + `/r/` route).

**Sending is still manual** — via `wa.me` deeplinks a human taps. So the WhatsApp API we
just set up should **automate SENDING the formats that already exist**, not introduce new
ones. → **Correct PR #500:** the POP auto-send should emit the established
`payment.celsiuscoffee.com` link message (as a template with the link as a variable), not a
new document-header template suppliers have never seen.

## The real #1 pain (every supplier): payment ↔ invoice ↔ PoP reconciliation
Not ordering. The recurring, time-eating failures are all money-matching:
- "which invoice is this PoP for?"; PoP amount ≠ invoice total; **missing delivery charges**;
  **double payments**; **short payments** ("short paid 80 cents"); wrong-account transfers +
  refunds; carry-forward of partial payments; duplicate auto-PoPs.
Examples: Jiju's ("balance lagi RM75… tak jumpa matching invoice"), GCR ("short paid 80
cents"), JS Breadserie (double-pay → discount next invoice), Farm Fresh (double-payment
needed a phone call), Collective (50/50 deposit+balance accumulating SOA).
→ **Highest-ROI build is a reconciliation ledger**, not auto-ordering. The auto-POP link
helps; matching/short/partial/double detection is still manual.

## Recurring cross-supplier patterns
1. **Multi-outlet fan-out + per-outlet MOQ** is the #2 pain. Every order → 3-4 outlets
   (Putrajaya/Conezion, Shah Alam, Tamarind/Cyberjaya, Nilai). Suppliers constantly ask
   "which outlet?"; MOQ thresholds (RM250/300/400/500/800/1000) trigger "add more" loops.
   Outlet + **legal billing entity** (the "FAH Coffee" / "Celsius Coffee Sdn Bhd" episodes)
   must be first-class data; validate MOQ at order time.
2. **Out-of-stock / substitution is COMMON** (more than assumed) and is THE human-judgment
   chokepoint. Pattern: supplier flags OOS → offers a sub (size swap 1L→700ml; alt brand) or
   partial delivery + back-order → Celsius confirms/drops. **Recipe-critical subs must never
   auto-accept** (cream fat % 35.1 vs 35.7, fries cut, matcha grade, choc vs butterscotch).
   → AI-propose / human-approve; never autonomous.
3. **Three payment models** the automation must branch on:
   - Prepay-before-delivery/production: HNJ, RICH's, Xora, BeansCo, Farm Fresh ("clear
     payment first / lorry loading now") — auto-POP-on-payment is delivery-critical.
   - Monthly credit + SOA batch settlement: GCR, BBM (14-day), Yow Seng.
   - Deposit + balance: Collective (50/50, two PoPs per order).
4. **Delivery is scheduling/routing, not just tracking.** Fixed per-supplier zones/days
   (GCR Tue/Thu, Jiju's Tue/Thu/Sat, RICH's Mon/Thu) + cut-offs (RICH's 1PM vs Celsius 6PM
   payment-release clash) + **Lalamove self-collect** as the universal escape hatch. Encode
   supplier delivery calendars + cut-offs. (Supplier model already has leadTimeDays/deliveryDays.)
5. **Two order triggers:** buyer-pull (most) vs **vendor-push weekly prompt** (Jiju's "any
   orders this week?", Farm Fresh "restock today?", Blancoz "any order this week?"). The
   reorder cron should support both.
6. **Order channel varies — not all WhatsApp-parseable.** Dankoff = email-of-record; HNJ =
   Sales Hero app; BBM = aliments.my PO links. For these, automation MIRRORS/TRACKS; it can't
   place the order by message. Don't assume WhatsApp parsing everywhere.
7. **Unit ambiguity is a constant error source** (kg vs g, tin/tub/carton/jar, boxes vs
   slices, "10 vs 12 pcs/box", "100g vs 1000g", "price column = qty?"). The structured
   template `item — qty unit (gram-weight)` directly targets this — keep it.
8. **Language = Manglish/Malay** code-switching, emojis, **voice notes (.opus)**, stickers,
   and **photos/PDFs for PoP + damage evidence**. Any AI reading inbound MUST handle Malay +
   media (image/PDF/voice), not English text only.
9. **Damaged / wrong goods** is a real recurring exception (Pavlova damage, foreign object in
   cake, wrong cream %, choc-vs-butterscotch, wrong-outlet delivery) → needs a structured
   damage / replacement / credit-note flow, not free-text.
10. **Staff churn on both sides** breaks continuity (Hidayah→Zuzamzuri→Ariff; suppliers
    rotate reps; Collective changed their bank account mid-relationship). → A system-of-record
    decouples the process from individual contacts: validates the inbox/message-store build,
    and means any auto-payee-details change needs a guarded, verified step.

## Revised priorities (improve the build)
- **P0 — Align POP auto-send with the existing format.** Make `proof_of_payment` carry the
  `payment.celsiuscoffee.com` receipt link message Celsius already uses, not a new document
  template. Reconcile with `staff-native/lib/ops/invoices.ts`.
- **P0 — Reconciliation ledger.** Match PoP ↔ invoice; flag short/partial/double/missing-charge;
  surface "which invoice unmatched." This is the real prize. Invoice model has the fields.
  _Shipped (v1): `/inventory/reconciliation` + `GET /api/inventory/invoices/reconciliation` —
  per-supplier statement of account (outstanding + aging) with a reconciliation-EXCEPTIONS list:
  the existing per-invoice money flags (duplicate/double-pay/wrong-account/tolerance) grouped by
  supplier, plus short-paid residuals, partial/deposit carry-forward, and AI-captured drafts to
  verify. Overpayment surfaces via flags (amountPaid is clamped to amount on payment), so the
  ledger aggregates flag-detector output rather than recomputing it. Open: automated PoP-amount ↔
  invoice matching from inbound payment images, and missing-delivery-charge detection._
- **P1 — Auto-send the order block on approval** (already generated) via the API, with MOQ +
  outlet + delivery-day/cut-off validation baked in (kills the "add more / which outlet /
  too late for today's lorry" loops).
  _Shipped (validation): `lib/inventory/order-validation.ts` (validateSupplierOrder +
  parseMoqRm + nextDeliveryDate, unit-tested) wired into ai-decisions — each drafted PO is
  checked against the supplier's trip MOQ (ringgit) with the exact top-up shortfall, shown as
  a warning on the PO card. Delivery-day check is built and fires once a date is set on the PO.
  Open: per-outlet legal billing entity._
- **P1 — Inbox/message-store (Option 1, in progress).** Capture all chats (done: Increment 1)
  → AI-parse inbound (Malay + media aware) → classify OOS / substitute / price-change /
  invoice / payment → propose action to a human.
  _Shipped (propose-to-human): when the agent escalates it now stamps a STRUCTURED PROPOSAL
  (intent + the declined PO edit + payment model) on the outbound message; the Supplier Chats
  inbox surfaces it as an "Agent suggests — your call" card. The agent never applies it._
- **P2 — OOS handling:** AI-propose / human-approve PO edit; recipe-critical always human.
  _Shipped (proposal capture): substitution offers are escalated WITH the structured swap
  detail (which line, the offered note) so the human sees a concrete proposal. WhatsApp-button
  one-tap approval remains the external-gated follow-up (needs a Meta-approved template)._
- **P2 — Per-payment-model + per-supplier rules:** prepay vs credit-SOA vs deposit; delivery
  calendar; legal billing entity per outlet.
  _Shipped: `lib/inventory/payment-model.ts` (unit-tested) classifies prepay / deposit+balance
  / credit-SOA / standard from depositPercent + terms. The agent treats prepay/deposit payment
  messages as delivery-critical; the inbox shows the model (⚡ when POP-gated). Delivery
  calendar lives in order-validation. Open: per-outlet legal billing entity._

## Reusable supplier archetypes (for the model)
- **Single-SKU prepay** (RICH's foam, BeansCo choc powder, Farm Fresh milk, BBM lamb,
  Collective home blend): the easiest end-to-end automation targets.
- **Catalogue restock credit/SOA** (GCR, Yow Seng broad-line, Unique packaging): structured
  catalogue + MOQ + monthly settlement.
- **Bake/make-to-order** (Cake Discovery, JS Breadserie, Jiju's, Blancoz, Xora cups): "OOS" =
  lead-time wait; vendor-push prompts common.
- **External-channel** (Dankoff email, HNJ app, BBM portal): mirror/track only.

## Agent v1 — what got baked into the prompt (2026-06-26)
`apps/backoffice/src/lib/inventory/agents/supplier-chat-agent.ts` turns these learnings into behaviour. A cached `PLAYBOOK` system block carries the Malay/Manglish glossary (takde/kosong/otw/cuti/ctn…), the Celsius voice (warm, terse, "bos", 🙏), and the auto-vs-escalate matrix:

- **Auto (full-auto, no human):** unambiguous OOS → `remove_item`; clear smaller qty → `reduce_qty`; plain delivery/ETA, order confirmation, greeting, closure notice → short conversational reply, no PO change.
- **Always escalate** (holding reply, PO untouched, human decides): ANY substitution offer ("same quality" is the trap — cream 35.7 vs 35.1); price increase / quote commitment; MOQ top-up; payment / PoP / payment-gating / reconciliation (agent can't read invoice/PoP images); complaints / damaged / wrong goods; e-invoice / PO-number / TIN / credit terms; ambiguous qty or unit → clarify.

Rollout is gated: `PROCUREMENT_AGENT_ENABLED` (off by default) + `PROCUREMENT_AGENT_ALLOWLIST` (last-8 phone digits; scope the first live run to the Test supplier). Shipped in PR #526. Substitution auto-accept and the reconciliation ledger remain the open high-ROI follow-ups.
