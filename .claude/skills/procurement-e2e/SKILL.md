---
name: procurement-e2e
description: Exercise or debug the procurement loop end-to-end (inventory-driven PO → WhatsApp supplier-chat agent → POP auto-send). Use when testing procurement changes, investigating supplier-agent misbehaviour, or verifying the loop after deploys.
---

# Procurement loop — E2E test

Canonical runbook: `docs/design/procurement-e2e-test-runbook.md` (follow it for
the full test matrix and seed SQL). This skill is the map plus hard-won caveats.

This is a **live** test: it needs the deployed BackOffice, a phone holding the
test supplier's WhatsApp number, and real WhatsApp Cloud API traffic. There is
no local simulator.

## Scope — what's automated vs not

- Automated: reorder recommendation (`ai-decisions`), inbound supplier-message
  handling (`handleSupplierMessage` — auto-edits PO for clear OOS/qty/date,
  vision-captures invoices, escalates the rest), POP auto-send on invoice PAID.
- **Not wired:** automated PO-send to the supplier (`purchase_order` /
  `po_approval` buttons — designed, never shipped). Creating the PO in
  BackOffice is enough; the agent only needs an open PO (DRAFT counts).

## Phases (details in the runbook)

1. **Prereqs** — env flags (`PROCUREMENT_AGENT_ENABLED`, allowlist by last 8
   digits, `PROCUREMENT_WHATSAPP_ENABLED`, WhatsApp creds incl.
   `WHATSAPP_APP_SECRET`), approved `proof_of_payment` Meta template, ACTIVE
   test supplier, webhook subscribed to `/api/whatsapp/webhook`.
2. **Force a reorder recommendation** — below-par condition on test
   outlet+product: supplier price set, par level set, stock ≤ reorderPoint, no
   surplus at other outlets, no existing open PO. Seed SQL in the runbook —
   **staging DB only, never production**.
3. **Create the PO** from AI Decisions; sanity-check On-Order column, price
   trend %, below-MOQ warning.
4. **Agent test matrix** — send the runbook's messages (Malay included) one at a
   time; verify reply, Supplier Chats thread, and PO state after each. Clear
   intents auto-apply; substitutions/MOQ/payment/ambiguity must ESCALATE with
   no PO change.
5. **POP flow** — attach invoice, record payment, mark PAID → `proof_of_payment`
   auto-sends; check `popSentAt` and the "POP sent" pill.

## Debugging handles

- Agent log line: `[supplier-agent] supplier=… po=… intent=… conf=… action=… escalate=…`
- POP log: `[invoices/[id]] POP auto-sent …` or `… POP not sent reason=…`
- No inbound reaching the agent at all → almost always a missing/wrong
  `WHATSAPP_APP_SECRET` (signature-rejected before the agent runs).
- POP receipt must be the **last** photo on the invoice and a direct public
  file URL, not a redirect.
- POP send is best-effort: a WhatsApp failure won't fail the payment write —
  absence of an error in the UI proves nothing; check the log line.

## Known gaps (don't chase these as bugs)

- PO-send + `po_approval` buttons: not wired.
- Stock accuracy is shadow-only (consumption engine off); reorder runs off
  receipts − wastage/transfers, not sales.

## Lessons

_Append dated entries when this skill misses something. Promote stable ones into
the sections above._
