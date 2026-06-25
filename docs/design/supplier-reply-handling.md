# Supplier Reply Handling — and the "AI edits the PO" question

_Office-hours diagnostic — 2026-06-24. Status: pre-build. Verdict: reframe._

## Problem Statement
User asked for an AI agent that (a) two-way communicates with suppliers over
WhatsApp and (b) auto-edits the PO when an item is unavailable. The diagnostic
showed the stated solution targets a symptom; the real pain is **"lots of
stockout, overpurchase, human error"** across procurement.

## Demand Evidence
- Q1 — supplier "item unavailable" replies: *"sometimes, handled in a quick
  reply."* LOW direct pain. The status quo (one WhatsApp message back) wins.
- Q2 (push 2) surfaced the real pain: *"currently lots of stockout, overpurchase,
  human error."* So demand is real — but for **reducing stockout/overpurchase**,
  NOT for an AI supplier-negotiator.

## Status Quo (what users do now)
Supplier says X unavailable → quick WhatsApp reply sorts it → but the PO/stock
system frequently isn't updated to match → data drifts → feeds stockout,
overpurchase, and human error.

## Target User (named person, role, consequence)
Whoever runs procurement (owner / a manager) — not yet named. Consequence:
stockouts lose sales; overpurchase wastes cash + causes F&B spoilage.

## Reframe (the key finding)
The AI-supplier-agent is the **wrong lever** for the stated pain. Stockout and
overpurchase are driven by ordering the wrong quantities and the system not
matching reality — both attacked by the deterministic **approval-gated reorder
loop** (procurement loop Increments 1-4) + **accurate stock data**, not by an LLM
chatting with suppliers. An LLM autonomously editing POs (money/inventory) off
free-text supplier messages ADDS a new error source to a process whose core
problem is already too much error.

## Narrowest Wedge
Capture the supplier's WhatsApp reply (inbound webhook already exists) and FLAG
it to the owner with a link to edit the PO — closing the "fix lived only in the
chat → drift" gap. Zero AI.

## Premises (explicit assumptions)
- Inbound supplier replies land on the existing webhook (needs WHATSAPP_APP_SECRET
  set to validate signatures).
- Suppliers actually reply on WhatsApp (vs call / in person) — UNVERIFIED.
- The dominant stockout/overpurchase driver is stock-data accuracy + par levels,
  NOT unavailability handling. If true, this whole feature is a sideshow.

## Approaches Considered

### Approach A — Capture + flag (days). No AI.
Inbound supplier reply → notify the owner ("Bean Bros: '<message>'" + a link to
the PO). Owner edits the PO manually. Kills the chat-only drift. Reuses the
webhook + the WhatsApp/Telegram notifier.

### Approach B — AI proposes, human approves (weeks).
An LLM reads the supplier reply, classifies it (unavailable / price change /
delay / substitution), and PROPOSES a specific PO edit (drop line, change qty)
that the owner approves with the same Approve/Reject buttons. Human-gated. Uses
the existing ANTHROPIC_API_KEY.

### Approach C — Autonomous AI agent (months). NOT recommended.
LLM negotiates + edits POs end-to-end, no human. High blast radius; adds error
to an error-plagued process. Exactly the wrong direction for the stated pain.

## Recommended Approach
**Ship the core procurement loop first** (Increments 1-4 + the stock-accuracy
work) — that is what actually reduces stockout/overpurchase. For supplier replies,
**Approach A (capture + flag)**. Graduate to **B (AI-proposes / human-approves)**
ONLY after A shows supplier replies are frequent and structured enough to be worth
it. **Never C.**

**What flips me to B:** A running for a few weeks shows enough reply volume AND the
owner repeatedly making the same mechanical edit an LLM could pre-draft.

## Open Questions
- Do suppliers actually reply on WhatsApp, or by call / in person?
- What share of stockout/overpurchase traces to (a) unavailability not updated vs
  (b) wrong par levels vs (c) stock-count drift vs (d) ordering by gut? This
  decides whether this feature matters at all next to the core loop.
- Named owner of procurement?

## Success Criteria (measurable)
- Stockout incidents / month and overpurchase RM / month — baseline, then reduce.
- % of supplier-agreed changes that make it into the PO/system (target: drift → 0).

## The Assignment (one concrete next step)
For the next 2 weeks, every time an item is short OR over-ordered, write ONE line:
the cause — (a) supplier unavailable + not updated, (b) wrong par level, (c) stock
count was off, (d) ordered by gut. Tally at the end. If (a) is rarely the top
cause, the AI-supplier-agent is a distraction — fix the actual top cause (almost
certainly par levels / stock accuracy) instead.
