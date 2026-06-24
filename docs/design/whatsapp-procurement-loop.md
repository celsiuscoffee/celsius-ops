# WhatsApp Procurement Loop (PO + POP to suppliers)

_Office-hours diagnostic — 2026-06-24. Status: pre-build._

## Problem Statement
Owner wants procurement messaging to suppliers to run as "a loop without a
staff" — Purchase Orders (PO) and Proof of Payment (POP) sent over WhatsApp
with no human assembling/typing/sending them. Built on the now-live WhatsApp
Cloud API (app "Celsius Coffee Ops", WABA 974771538513990, send-helper at
`apps/backoffice/src/lib/whatsapp.ts`).

## Demand Evidence
Weak-to-moderate. The driver is **labour removal**, not a bleeding pain:
"I want to make this a loop without a staff." No named recurring failure
(lost POs, disputes) was cited. Cost is a non-factor — utility template
messages are ~RM 0.07 each (~RM 0.14 per supplier per order). So the
justification rests entirely on **eliminating manual effort**, which only
pays off if the effort is real and the task is safely mechanical.

## Status Quo (what users do now)
- **Order decision:** Owner states par-levels / reorder points already exist in
  BackOffice, so the system "already knows" supplier + quantity when stock
  drops. (UNVERIFIED — see Premises.)
- **Payment:** Suppliers deliver + invoice; payment happens **later, in
  batches, by hand**, decoupled from the PO. A POP therefore only exists after
  a human pays.

## Target User (named person, role, consequence)
Not yet named. The "user" being removed is whoever currently assembles + sends
POs (likely the owner or a procurement/admin person). **Open:** who is it, and
how many hours/week does PO+POP handling actually cost them? Without that
number, "loop without staff" is automation for its own sake.

## The two problems are NOT the same
- **PO is automatable** — decision (what/how much/which supplier) can be
  computed from par-levels; sending is mechanical. Staffless is feasible *if
  stock data is trustworthy*.
- **POP is structurally human-gated** — payment is a manual, batched, later
  bank transfer the system can't and shouldn't perform. Only the *sending* of
  the receipt can be automated, triggered by a human recording the payment.

## Premises (explicit assumptions — each a build risk)
1. **Stock data is accurate enough to auto-order.** LOAD-BEARING. F&B stock
   drifts (spoilage, free pours, miscounts). If false, auto-PO orders the wrong
   things with money attached. → This is why a human approval gate is cheap
   insurance.
2. **A supplier catalogue exists**: each product → one supplier + current
   price + pack size + MOQ. Needed to turn "below par" into a real order line.
3. **A PO document/format exists** (PDF or structured text) to attach.
4. **Supplier WhatsApp numbers + consent** are captured.
5. **Payments are recorded somewhere** the system can read to trigger a POP.
   Currently "pay later in batches" suggests they are NOT — so POP auto-send
   has no trigger yet.

## Approaches Considered

### Approach A — Send buttons (narrowest, ~2-4 days)
"Send PO via WhatsApp" + "Send POP via WhatsApp" buttons in BackOffice. Human
clicks; system sends the approved utility template + PDF/receipt to the
supplier. No decision automation. Ships this week; foundation for everything
else. **But: not staffless** — doesn't match the stated goal.

### Approach B — Approval-gated loop (~1-2 weeks) ★ recommended
- **PO:** below-par detection → system drafts the PO → pings the OWNER on
  WhatsApp ("Order 20kg beans from X — RM Y. Approve? [Yes/No]") → on Yes,
  sends to supplier. One-tap human gate (~5 sec), protects against bad stock
  data.
- **POP:** when a payment is recorded (a human action in finance/BackOffice),
  auto-send the receipt to that supplier.
Removes ~95% of the labour; keeps the judgment gate that prevents disasters.

### Approach C — Fully staffless (weeks-months)
Below-par auto-fires PO straight to supplier, no human. Requires trustworthy
stock data + complete supplier price/MOQ catalogue + guardrails (per-order
caps, anomaly detection, supplier confirmation handling). POP auto-sends on
recorded payment. High blast radius if any premise is wrong.

## Recommended Approach
**Approach B.** It delivers the staffless *feeling* (nobody assembles or types
POs) while keeping a one-tap approval that insures against the unverified
stock-accuracy premise. Notably, the approval gate itself uses the WhatsApp
loop we just built — the owner approves from their phone.

**What flips me to C:** ~3 months of Approach B data showing auto-drafted POs
are approved >95% unchanged. That proves the par-level math + supplier
catalogue are trustworthy enough to drop the gate. Until then, C is a way to
auto-order mistakes faster.

## Open Questions
- Stock-accuracy hit-rate (the assignment below).
- Does a supplier catalogue with price/pack/MOQ exist, or must we build it?
- Does a PO PDF/format exist today, or do orders go out as plain text?
- Where would a "payment made" signal come from to trigger POP?
- Who is the named person whose hours this removes?

## Success Criteria (measurable)
- PO: % of below-par events that result in an approved+sent PO without a human
  assembling it (target: the human only taps Approve).
- POP: % of supplier payments that auto-send a receipt within 1h of being
  recorded.
- Net: hours/week of procurement admin removed (baseline it first).

## The Assignment (one concrete next step)
Before any code: **pull the last 10 POs that actually went to suppliers.** For
each, write down what the par-levels / reorder points *would have* auto-ordered
(item, qty, supplier). Count how many match what was really ordered.
- ≥8/10 match → stock data is trustworthy; Approach B's auto-draft is safe.
- <8/10 → data isn't ready; the human gate is mandatory, and step one is fixing
  stock accuracy, not WhatsApp.
Also note: does a PO document even exist today, or do orders go out as ad-hoc text?

---

## Implementation Plan — Approach B (decided 2026-06-24)

Decisions: approval via **WhatsApp Approve/Reject quick-reply buttons**; PO/POP as
**structured text** (summary + short-link, since template params can't hold newlines).

Existing infra (from code map, ~75% built): `Order` model = PO with
DRAFT→PENDING_APPROVAL→APPROVED→SENT lifecycle; `ai-decisions` route already detects
below-reorderPoint + cheapest supplier + qty; `Invoice` has paidAt/paymentRef/
popShortLink/popSentAt; `Supplier.phone`; cron pattern (`checkCronAuth`); Supabase
`invoices` bucket; `lib/shortlink.ts`; `lib/whatsapp.ts` send-helper.

### Flow
1. Cron `procurement-reorder` (daily) → ai-decisions → group below-par by cheapest
   supplier → create DRAFT `Order`s (idempotent on clientRequestId) → send the
   OWNER a `po_approval` template per PO with Approve/Reject buttons (payload encodes
   orderId).
2. Owner taps **Approve** → webhook button-reply → Order APPROVED→SENT → send supplier
   the `purchase_order` template (summary + short-link to full itemized PO). **Reject**
   → Order CANCELLED.
3. Human pays supplier later (batched) → records payment in BackOffice → Invoice→PAID →
   auto-send supplier the `proof_of_payment` template (summary + popShortLink); stamp
   popSentAt.

### Prerequisites
- `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_APP_SECRET` set on celsius-backoffice/Production
  (app secret is REQUIRED — inbound button replies are signature-validated).
- The 3 templates below APPROVED by Meta.
- A public, tokenized PO-view page (no login) for the supplier link — reuse shortlink pattern.

### Templates to submit (WhatsApp Manager → category Utility, language en)

**1. `po_approval`** (business-initiated → OWNER). Buttons: Quick Reply × 2.
```
Body:
🛒 PO {{1}} ready for {{2}}.
{{3}} item(s) · total RM {{4}} · deliver by {{5}}.
Review the full order: {{6}}
Buttons (Quick reply): [✅ Approve]  [❌ Reject]
```
Vars: 1=PO no, 2=supplier name, 3=item count, 4=total, 5=delivery date, 6=PO link.
Send-time: attach button payloads `approve:<orderId>` / `reject:<orderId>`.

**2. `purchase_order`** (business-initiated → SUPPLIER).
```
Body:
Hi {{1}}, new purchase order from Celsius Coffee.
PO {{2}} — {{3}} item(s), total RM {{4}}.
Deliver by {{5}} to {{6}}.
Full order + items: {{7}}
```
Vars: 1=supplier/contact, 2=PO no, 3=item count, 4=total, 5=delivery date, 6=outlet, 7=PO link.

**3. `proof_of_payment`** (business-initiated → SUPPLIER). **Header: Document (the POP PDF).**
```
Header: DOCUMENT  (the payment receipt PDF, attached)
Body:
Hi {{1}}, payment confirmation from Celsius Coffee.
Invoice {{2}}: RM {{3}} paid. Ref {{4}}.
Receipt attached. 🧾
```
Vars (body): 1=supplier/contact, 2=invoice no, 3=amount, 4=payment ref.
Send-time: header param = `{type:"document", document:{link:<DIRECT Supabase PDF URL>,
filename:"POP-<invoice>.pdf"}}`. Use the bucket's direct public URL, NOT popShortLink
(WhatsApp media fetch won't follow a redirect). When creating the template in WhatsApp
Manager, upload a sample PDF for the Document header.

### Build order
1. POP auto-send (lowest risk, reuses popShortLink). 2. PO send-on-approval + public PO
view. 3. Button-reply webhook handling. 4. Reorder cron + vercel.json schedule.
