# Procurement Exec agent — design

The agent's job is not "answer supplier messages." It's the standing job of a
senior procurement executive: **keep every outlet supplied, never overstocked, at
the lowest sound cost, with clean supplier + finance standing.**

The conversational supplier-chat agent (`supplier-chat-agent.ts`) is the **mouth**.
This is the **brain** — a *stateful controller* that owns a goal and works it on a
schedule, using the chat agent, the reorder engine, re-source, GRN/invoice chasers,
reconciliation, consumption, and finance as **tools**. We build the brain *around*
those tools instead of rewriting the mouth (this also stops the two procurement
sessions colliding on one file).

> **Supplier intelligence:** how each supplier actually behaves (reply speed,
> reliability, delivery/SOA/invoice/troubleshoot patterns) — mined from 17 historical
> chats — is documented in [`procurement-supplier-chat-intelligence.md`](./procurement-supplier-chat-intelligence.md)
> and seeded into `supplier-behavior.ts`.

## Standing goal
For every **outlet × item**: enough on-hand + on-order to cover lead-time demand,
and no more than the cap (max level in **units AND ringgit value**), at the lowest
sound landed cost, with no payment-blocked supplier relationships.

## The books it keeps (procurement state) — per outlet × item
- `on_hand`, `on_order`, avg daily usage (consumption engine) → **`days_to_stockout`**
- `stock_value` (RM) vs **`max_stock_value`** cap → over / under
- `reorder_point` / `par` / `max_level`
- latest landed unit cost + price trend (`PriceHistory`) vs **COGS budget**
- open **GAPS** (predicted or real shortfalls: item, qty short, promised-back date,
  the re-source PO) and open **invoices / payment blocks**

## Policies — the guardrails it never crosses (maps to the owner's asks)
1. **Not OOS** — order/re-source so projected on-hand never hits 0 before lead time;
   `days_to_stockout` drives *urgency* and *when* to escalate.
2. **Not overpurchase** — order qty ≤ max-level headroom AND ≤ shelf-life × usage AND
   ≤ **max-stock-VALUE headroom** (extends `boundedReorderQty` from #538).
3. **Manage COGS** — prefer cheapest *sound* source; flag price creep vs budget; never
   over-order (waste = COGS).
4. **Finance comms** — payment-gating ("clear payment first / settle pending inv /
   COD") → check the invoice + payment status → **hand off to finance** (alert / AP)
   with the exact unpaid invoices. Never auto-pay.
5. **Max stock value** — a per-outlet/item RM ceiling it sets + enforces (#2).

## What it does on a schedule (the controller loop)
Daily (+ on events: supplier message, GRN, payment):
1. Refresh the books for every outlet × item.
2. Plan each gap → **order** (within caps) / **re-source** / **chase supplier** /
   **escalate with a decision-ready brief** (never an empty holding line).
3. **Follow through** — every open gap + supplier promise is tracked; follow up on
   the promised date; close when filled; escalate only when *still open near
   time-to-stockout*. (This is the chatbot→exec line: "I'll get back" becomes a
   scheduled, tracked commitment.)
4. Hand off to finance when payment-blocked.
5. **Score** — fill rate, stockouts prevented, COGS vs budget, cash committed,
   overstock RM. The scorecard is the proof it's an exec, not a chatbot.

## Tools it orchestrates (already built — reuse, don't rewrite)
supplier-chat agent · reorder engine (`ai-decisions` + `boundedReorderQty`) ·
`createReSourcePO` · PO auto-send · invoice capture (vision) · GRN chaser ·
invoice chaser · reconciliation ledger · consumption engine · verifier.

## Build sequence (incremental PRs)
- **Inc 1 — spine:** `Procurement gap/state` (model + migration) + `lib/inventory/exec/*`
  controller + close-the-loop **follow-up cron**. Turns shortfalls + promises into
  tracked, scheduled commitments.
- **Inc 2 — policy guardrails:** max-stock-value + overpurchase caps + COGS budget,
  enforced on every order/re-source.
- **Inc 3 — proactive ordering:** the exec initiates POs from the engine *before*
  stockout (buyer-pull + the vendor-push "any order this week?" prompts).
- **Inc 4 — finance handoff:** payment-gating → finance alert with unpaid invoices.
- **Inc 5 — judgment:** supplier-reliability memory, voice-note (.opus) transcription,
  delivery-calendar/cut-offs, negotiation bounds, the scorecard.

## Architecture / coordination note
New modules live under `lib/inventory/exec/*` + crons. The supplier-chat agent stays
the **mouth** (the other procurement session can keep refining it). Minimal overlap →
the two efforts stop colliding on one file. One owner per layer.
