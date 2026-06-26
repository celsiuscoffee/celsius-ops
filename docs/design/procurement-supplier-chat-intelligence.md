# Procurement — supplier chat intelligence

What we learned by mining **17 historical WhatsApp supplier chats** (≈19k parsed
messages, 2021–2026). This is the ground truth that feeds the Procurement Exec
(`procurement-exec-agent.md`): how each supplier actually behaves, and the real
message patterns the agent must understand. Numbers are reproducible from the
chats under `Desktop/Celsius/Purchasing Chat` via the mining scripts; the
per-supplier baseline is committed at
`apps/backoffice/src/lib/inventory/exec/supplier-behavior-seed.json`.

> The exec uses this as a **baseline** and overrides it with live `WhatsAppMessage`
> data as it accumulates (`supplier-behavior.ts`: `source: baseline → blend → live`).

---

## 1. Per-supplier behaviour baseline

Reply speed + reliability are mined from message timing; delivery / invoice /
trouble columns are message-pattern counts (rough volume, not severity).

| Supplier | Reply (median) | Reliability (OOS%) | Delivery msgs | Invoice/SOA | Trouble |
|---|---|---|---|---|---|
| **JG Pacific** | ⚡ 5m | ⚠️ low (1.5%) | 63 | 46 | 5 |
| **Yow Seng** | ⚡ 3m | ⚠️ medium (2.5%) | 56 | 22 | 14 |
| **BGS** | ⚡ 2m | ⚠️ medium (2.3%) | 40 | 23 | 4 |
| **Unique** | ⚡ 7m | ⚠️ medium (1.5%) | 51 | 59 | 15 |
| **Dankoff** | ⚡ 10m | ✅ high (0.9%) | 125 | 67 | 10 |
| **Blancoz** | ⚡ 2m | ✅ high (0.4%) | 59 | 37 | 29 |
| **GCR** | ⚡ 1m | ✅ high (0.4%) | 16 | 18 | 6 |
| **Milk Moka** | 12m | ✅ high (0.5%) | 61 | 10 | 6 |
| **Collective** | ⚡ 10m | ✅ high (0.2%) | 76 | 19 | 10 |
| **BeansCo** | 12m | ✅ high (0%) | 66 | 44 | 13 |
| **BBM** | 25m | ✅ high (0%) | 80 | 20 | 3 |
| **Cake Discovery** | 23m | ✅ high (0%) | 75 | 64 | 7 |
| **JS Breadserie** | 🐢 37m | ✅ high (0%) | 130 | 24 | 7 |
| **Jiju's** | ⚡ 6m | ✅ high (0%) | 27 | 9 | 3 |
| **RICH's** | 22m | ✅ high (0%) | 10 | 6 | 6 |
| **Xora** | ⚡ 4m | ✅ high (0%) | 15 | 11 | 1 |
| **HNJ** | ⚡ 3m | ✅ high (0%) | 4 | 0 | 2 |

**Read:** chase slow repliers (JS Breadserie, BBM, Cake Discovery, RICH's) sooner;
de-risk the OOS-prone (JG Pacific, Yow Seng, BGS, Unique) for critical lines.
Lead time isn't reliably derivable from chat alone — the exec computes it live from
PO `sentAt → first receiving`.

---

## 2. Message-type playbook (what the agent must handle)

Volume order, with **real supplier phrasings** so the agent learns the actual
language (Malay + English code-switching is the norm).

### 2.1 Delivery updates & delays — *the #1 supplier-initiated type (~950)*
Suppliers proactively self-report ETAs, reschedules, and reasons. This is the
richest **lead-time / ETA** signal.
- "Esok hantar ye" · "Ok we'll send down tomorrow ya"
- "We will deliver tomorrow. So sorry we are still lack of staffs."
- "we have to drag the date to Tuesday 17th Jan, due to shortage of raw [material]"
- "Jugak untuk Nilai area guna courier service, takut public holiday delay banyak"
- "Takut tak sempat" (afraid won't make the cut-off)

**Agent action:** parse the promised date/reason → set the PO's expected delivery
date + open/refresh a gap with `promisedBackDate` → follow up *on that date* (not
generic). Delay reasons (staff shortage, raw shortage, public-holiday courier) are
a leading indicator of an OOS — escalate early for critical lines.

### 2.2 Payment is **SOA-based**, not per-invoice — *(~270 mentions)*
This is the single most important finance learning. Suppliers reconcile and chase
payment via a **Statement of Account (SOA)**, monthly, not invoice-by-invoice.
- "Hello, here's the latest SOA for your payment ready! Thank you!"
- "Here's the latest SOA as 30th April 2025 for your perusal."
- "This payment has been received, and shown at the SOA for Shah Alam ye"
- "It will reflect at October statement ye"
- "INV-10056484 short paid 80 cents" (line-level discrepancies surface against the SOA)

**Agent action:** the finance handoff (Inc 4) must be **SOA-aware** — when a supplier
sends an SOA, capture it, reconcile against our paid invoices, and route the
*outstanding* (not each invoice) to finance. Recognise "short paid / reflect at
statement" as reconciliation, not a new charge.

### 2.3 Invoice changes — revise / credit-note / price-increase — *(~40)*
A clear, repeatable set of revision flows:
- **Revise invoice/PO:** "need to revise invoice 22/6/2023…" · "can you send revise PO?"
- **Credit note vs replace:** "Shall we CN or replace for next order?" · "yes new
  invoice and credit note" · "We will exchange and issue CN, differences need to be top up"
- **Price increase notice:** "Anchor product price increase this month"

**Agent action:** on a revise request → regenerate the PO/invoice and re-send. On
defect/short → decide **CN vs replacement-next-order** and track it to closure. On a
price-increase notice → update the supplier price + **flag COGS impact** to the exec
(this is the price-creep signal in the brief).

### 2.4 Troubleshooting — defect / short / wrong item — *(~30 genuine)*
Lower volume but needs ownership; resolution is usually CN or replace.
- "Replacement utk last week defect"
- "He will return in short while [to retake the wrong item]"
- "Bro… can you confirm with your uncle if he gonna resend or retake the wrong [item]"
- "Any order missing out?"

**Agent action:** log the issue against the PO/GRN, request replacement **or** credit
note, and **don't close the gap** until resolved. Repeated defects from one supplier
feed the reliability score (de-risk).

### 2.5 Vendor-push reorder prompts — *(~85)*
Suppliers proactively solicit the week's order — a second ordering channel beside
our buyer-pull reorder engine.
- "Do we need to prepare any order for this week? Thank you!"
- "Feel free to let us know if you guys want to order for this week too."

**Agent action:** treat as a reorder trigger — pull that supplier's below-par lines
and reply with the week's order (within caps), or confirm "nothing this week." Don't
leave these unanswered (a missed prompt = a missed restock window).

---

## 3. How this feeds the exec

| Pattern | Wired today | Module |
|---|---|---|
| Reply speed → chase timing | ✅ `isReplyOverdue()` (4× median) | `supplier-behavior.ts` |
| Reliability (OOS) → flag/de-risk | ✅ `behaviorTag()` in the daily brief | `exec-controller.ts` |
| Lead time → ETA / overdue | ◑ live from `sentAt → receiving` (fills in) | `supplier-behavior.ts` |
| Doc timing → invoice chase | ◑ baseline captured; chaser uses windows | `invoice-requester.ts` |
| Delivery-date parsing → PO ETA | ✅ classify + parse; applies to PO behind `PROCUREMENT_EXEC_APPLY_ETA` | `message-intel.ts` |
| SOA / price / issue / vendor-push detection | ✅ classified + surfaced in the daily brief | `message-intel.ts` |
| SOA → reconcile vs unpaid invoices → finance handoff | ✅ `intent-responder.ts` | exec |
| Vendor-push → draft the week's order; missed-ETA → chase | ✅ `intent-responder.ts` (send behind `PROCUREMENT_EXEC_AUTO_REPLY`) | exec |
| Invoice revise / CN actions | ◑ flagged for review; auto-action pending | (agent — mouth) |
| Voice-note (.opus) transcription | ☐ needs audio-model integration | (new) |

> **Why decoupled works here:** the chat agent bails when there's no open PO
> (`agent.ts: if (!order) return`), so SOA / vendor-push / price messages never get a
> reply from it. The responder owns exactly those — no double-reply, no shared file.

✅ done · ◑ partial / self-improving · ☐ planned

---

## 4. Notes
- Mining excludes media-omitted lines and links; "no problem" false-positives are
  filtered out of the troubleshoot count.
- "Celsius staff" senders are auto-detected as any name appearing in ≥3 chats (they're
  in every chat); everyone else is the supplier side.
- These are internal supplier relationships — keep this doc in-repo only.
