# Procurement Loop + AI Verifier (2026-06-26)

Two things: (1) the procurement loop we've designed, end to end, and (2) a
second AI agent — the **verifier** — that independently audits the procurement
agent's decisions so a human can trust (or catch) them.

---

## 1. The loop we designed

The procurement loop is **sense → decide → act → verify → learn**, with a human
approval gate on anything that moves money or stock. Each stage is a real
module/screen in the codebase.

```
                         ┌──────────────────────────────────────────────┐
                         │                  SENSE                         │
                         │  • StockBalance, sales/consumption, par levels │
                         │  • On-order netting (open POs)                  │
                         │  • Price history, supplier scorecard           │
                         └───────────────┬────────────────────────────────┘
                                         │ what's low / running out
                                         ▼
                         ┌──────────────────────────────────────────────┐
                         │                  DECIDE                        │
                         │  ai-decisions: reorder engine                  │
                         │  • boundedReorderQty (MOQ, max-level,          │
                         │    shelf-life caps)                            │
                         │  • alternative suppliers (next-cheapest)       │
                         │  • price-trend + payment-model context         │
                         └───────────────┬────────────────────────────────┘
                                         │ suggested PO (qty, supplier, price)
                                         ▼
                    ┌───────────────  HUMAN APPROVAL GATE  ───────────────┐
                    │  staff reviews → "Create PO" (DRAFT)                 │
                    └───────────────┬─────────────────────────────────────┘
                                    ▼
                         ┌──────────────────────────────────────────────┐
                         │                   ACT                          │
                         │  PO lifecycle: DRAFT → APPROVED → SENT →       │
                         │  AWAITING_DELIVERY → (PARTIALLY_)RECEIVED →    │
                         │  COMPLETED                                     │
                         │  • WhatsApp PO to supplier                     │
                         │  • Supplier-chat AI agent handles replies:     │
                         │      - auto: remove_item / reduce_qty /        │
                         │        delivery_date / capture_invoice         │
                         │      - escalate: substitution, cancel, price,  │
                         │        payment, MOQ, ambiguous, low-confidence │
                         │      - OOS → auto re-source DRAFT PO to alt     │
                         │  • Receiving (GRN), invoice capture, payment   │
                         └───────────────┬────────────────────────────────┘
                                         │ every agent decision stamped on
                                         │ the outbound message `raw` (audit)
                                         ▼
                         ┌──────────────────────────────────────────────┐
                         │                  VERIFY   ← NEW                │
                         │  verifier agent (independent LLM judge)        │
                         │  re-reads each agent decision in context and   │
                         │  rates it pass / concern / fail with specific  │
                         │  issues. Shadow-mode, flags only — never edits │
                         │  → Agent QA dashboard for the human            │
                         └───────────────┬────────────────────────────────┘
                                         │ flagged decisions, quality trend
                                         ▼
                         ┌──────────────────────────────────────────────┐
                         │                  LEARN                         │
                         │  • usage variance (real vs BOM)                │
                         │  • reconciliation exceptions                   │
                         │  • supplier scorecard, wastage                 │
                         │  • verifier verdicts → tune playbook/guardrails│
                         └────────────────────────────────────────────────┘
```

### Design principles (from the loop retrospective)
- **Human commits anything with money/stock.** Agents stage DRAFTs and held
  proposals; humans approve.
- **Guardrails in code, not the model.** Escalation triggers (substitution,
  cancel, price, payment, MOQ, ambiguity, confidence < 0.7) are enforced in
  `handleSupplierMessage`, not left to the LLM's judgement.
- **Shadow-mode + feature flags** for anything risky; dark-launch by allowlist.
- **Every decision is auditable** — stamped on the outbound message `raw`.
- **Ship the action with the insight** — no read-only dead-ends.

---

## 2. The verifier agent

**Problem it solves:** the procurement agent (`supplier-chat-agent`) acts
autonomously on a narrow set of cases and escalates the rest. But "did it act
*correctly*?" had no independent check — a wrong `remove_item`, a hallucinated
delivery date, an accepted substitution, or a missed escalation would only
surface if a human happened to read the thread. The verifier is a **second,
independent LLM** whose only job is to grade the first one.

### How it works
- **Independent judge.** It does NOT reuse the agent's prompt — it has its own
  condensed ruleset, so it doesn't inherit the agent's blind spots. It's
  prompted to be **skeptical** and default to flagging when unsure.
- **Same inputs, after the fact.** At decision time the agent stamps a compact
  `verifierInput` (the inbound message, PO line snapshot, recent thread,
  payment model) alongside its decision on the outbound message `raw`. The
  verifier reads that — so it judges exactly what the agent saw, and the verdict
  is reproducible even if the PO changed later.
- **Verdict shape:** `rating` (pass | concern | fail), `confidence`, `issues[]`
  (specific problems), `summary`, `recommendedAction`.

### What it checks (mirrors the guardrails it's auditing)
1. **Mis-escalation** — auto-acted on something that should escalate
   (substitution, cancel, price/quote, payment/PoP, MOQ, ambiguity), or
   escalated something trivial.
2. **Wrong PO edit** — removed/reduced the wrong line, or acted when the item
   wasn't unambiguously identified; quantity assumed rather than stated.
3. **Hallucinated delivery date** — set a date from "otw / dah hantar / sampai"
   (not a future commitment).
4. **Invoice handling** — captured but discussed/confirmed the amount (it must
   not), or missed an obvious invoice/SOA.
5. **Reply safety** — confirmed an action it didn't take, made a price/credit
   commitment, or leaked internal info (e.g. naming the re-source alt supplier
   to the chatting supplier).
6. **Language mismatch** — replied in the wrong language.
7. **Confidence calibration** — high confidence on a genuinely ambiguous case.

### When it runs — automatic, closing the loop
To replace the human reviewer (not just assist one), the verifier runs
**automatically on every decision**, inline in `handleSupplierMessage`, the
moment the agent acts. The supplier reply is already sent by then, so the check
never delays the conversation. This is the loop-closing step: the *check itself*
is automated, so no human has to remember to run it.

- **Auto-escalation on fail.** A `fail` verdict surfaces the thread as
  **needs-attention** in the Supplier Chats inbox (the inbox treats "the newest
  message is an auto-decision the verifier failed" as a flag). So a human is
  pulled in *exactly* when the independent check catches something — and only
  then. `pass`/`concern` stay silent in the QA log.
- The Agent QA dashboard's **"Run checks"** remains for back-filling decisions
  made while the verifier was off, or re-sweeping history.

### Safety (same rules as the loop)
- **Shadow-mode**, gated by `PROCUREMENT_VERIFIER_ENABLED`. Off → no calls, no
  auto-run.
- **Flags only.** The verifier never edits a PO, never messages a supplier,
  never changes the agent's decision. It writes a verdict to `raw.verifier`,
  raises needs-attention on a fail, and surfaces everything on Agent QA. (It does
  NOT auto-undo an action — reverting is a separate, riskier capability we'd add
  deliberately, not silently.)
- **Idempotent.** A decision already carrying `raw.verifier` is skipped; re-runs
  are safe.
- **Best-effort + isolated.** The auto-verify call is wrapped so a verifier
  error never affects the agent's reply or the webhook's 200.
- **Pure core + DB shell.** `verifier.ts` (prompt build + verdict parse) imports
  zero prisma and is unit-tested; `verifier-run.ts` does the DB + LLM I/O.

### Where the human sees it
**Agent QA** (`/inventory/agent-qa`) — a dashboard of recent agent decisions
with verifier verdicts: fail/concern surfaced at the top, pass-rate and
auto-act-rate cards, each row deep-linking into the supplier chat. Failed
decisions also light up the Supplier Chats inbox's needs-attention filter.

### Why a separate agent (not just stricter guardrails)
Guardrails are pre-action and rule-based; they can't catch a *correct-looking
but wrong* call (right action type, wrong line). An independent post-action
judge with a different prompt catches a different failure class — the
LLM-as-judge / adversarial-verify pattern. It also gives us a **quality signal
over time** to tune the agent's playbook.
