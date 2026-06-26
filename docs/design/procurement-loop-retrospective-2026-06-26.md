# Procurement Loop — Retrospective & Learnings (2026-06-26)

A reflective pass over the procurement build loop (PRs #500–#540) to capture
what worked, what didn't, and the rules we carry into the next iterations. The
goal isn't to re-list features — it's to learn from our own process so the next
loop is faster and lower-defect.

## The loop so far (what shipped)

| PR | Theme | Loop role |
|----|-------|-----------|
| #500 | WhatsApp POP auto-send + supplier-chat capture | foundation |
| #521 | Inbox reply/send (24h-window aware human takeover) | human-in-loop |
| #523–#524 | Supplier Chats nav + theme | surface |
| #526 | Full-auto supplier-chat AI agent | automation |
| #529 | Agent loop: invoice chase + delivery-date + invoice capture | automation |
| #532 | Reconciliation ledger, usage-variance, consumption data, QA fixes | decision data |
| #537 | Live-refresh Supplier Chats inbox (poll + auto-scroll) | realtime |
| #538 | Cap reorder qty (overstock/shelf-life) + alternative suppliers | decision quality |
| #540 | Auto re-source OOS lines to alternative supplier | decision continuity |

The arc: **capture → human reply → automate the reply → give the automation
good data → make the data actionable.** That arc is sound. The friction was in
*how* each step landed.

---

## What worked (keep doing)

1. **Approval-gating every automated mutation.** The agent proposes; a human
   approves. Re-source POs, substitution proposals, and qty edits all land as
   DRAFT or as a held proposal — never an irreversible action. This is why we
   could ship aggressive automation without fear. **Rule: an agent may compute
   and stage, but a human commits anything with money or stock attached.**

2. **Shadow-mode by default for risky engines.** The consumption engine shipped
   computing-but-not-writing, gated behind `CONSUMPTION_ENGINE_ENABLED`. We got
   the code reviewed and the math validated in production data *before* it could
   move a number. **Rule: new engines ship in shadow; flip live only after the
   shadow output is trusted.**

3. **Pure core + DB shell split, with the pure half unit-tested.**
   `boundedReorderQty`, `consumption.ts`, `usage-variance` core, `payment-model`,
   `flag-detector` are all pure functions with vitest coverage; the DB-touching
   wrappers (`consumption-post.ts`) are thin. This caught real logic bugs cheaply
   and kept tests runnable.

4. **Idempotency designed in, not bolted on.** The re-source PO checks for an
   existing pending draft before opening another; invoice capture de-dupes.
   Webhook-driven agents *will* fire twice — designing for it up front avoided a
   class of duplicate-PO bugs.

5. **Feature-flag + allowlist gating for the live agent.** `PROCUREMENT_AGENT_ENABLED`,
   an allowlist on the last-8 phone digits, and a separate WhatsApp-send flag let
   us dark-launch to one test supplier. **Rule: every external-effect path gets an
   independent kill switch.**

---

## What hurt (stop doing / guard against)

1. **Prisma `is`/`isNot` on *required* relations — hit TWICE** (usage-variance
   route, then resource-po.ts). `is`/`isNot` are only for *nullable* to-one
   relations; on a required relation Prisma errors at runtime, not compile time,
   so CI's typecheck doesn't catch it. **Rule: filter required to-one relations
   directly (`supplier: { status: "ACTIVE" }`), never `supplier: { is: {...} }`.
   Reserve `is`/`isNot` for nullable relations only.** This is now the single most
   repeated defect — worth a lint rule or a grep in pre-commit.

2. **vitest can't resolve the `@/lib/*` alias.** The consumption test failed CI
   with "Cannot find package '@/lib/prisma'" because a pure module imported prisma
   transitively. Cost a red CI + a split. **Rule: anything that will be unit-tested
   must not import prisma (even transitively). Keep the pure core import-clean.**

3. **Branching off pre-squash history → guaranteed merge conflict.** PR #536 was
   cut from a commit that the squash-merge had already collapsed on main,
   conflicting with itself. Had to recreate the doc on fresh main as #539 and close
   #536. **Rule: always `git fetch origin main && branch from origin/main` at the
   start of each loop iteration. Never branch from a feature branch that's been
   squash-merged.**

4. **We built the data before we built the action — repeatedly.** Reconciliation
   exceptions, agent proposals, re-sourced POs, report variances all shipped as
   *read-only surfaces*. The staffer sees the computed answer, then has to leave
   the screen and redo it by hand (open PO, edit line, save). We generated insight
   and stranded it one click away from being useful. **This is the biggest systemic
   miss.** **Rule: every computed recommendation ships with the button that acts on
   it, in the same view. "Surfaced" is not "done."**

5. **Realtime was an afterthought, fixed reactively.** The user had to report
   "not realtime, need to refresh" before we added polling — and only to Supplier
   Chats. The PO list, receivings, and invoices still go stale. **Rule: any list
   that reflects a mutable workflow state polls or revalidates by default; don't
   wait for the staleness complaint.**

6. **Structural blockers were deferred silently, not tracked loudly.** Unit
   normalization (StockBalance fragmented across packages with mixed base/pack
   units) and recipe/BOM import are the two things gating consumption going live —
   yet they live in scattered notes, not a visible blocker list. **Rule: keep the
   "what's stopping us going live" list explicit and at the top of the loop, so we
   don't keep building around the blocker.**

---

## The throughline: insight without action

Four of the six "what hurt" items are really one root cause — **we optimized for
producing correct information and under-invested in letting the staffer act on
it.** The agent got smart (good data, caps, alternatives, re-sourcing) but the
human's hands stayed slow (leave the page, find the record, redo by hand,
refresh to confirm). The next phase of the loop should bias hard toward
**closing the action gap**: apply/send buttons where the proposal lives, inline
edits where the suggestion lives, live state without reloads.

## Carry-forward rules (the checklist for the next iteration)

- [ ] Branch from a freshly fetched `origin/main`.
- [ ] Filter required relations directly; `is/isNot` only on nullable relations.
- [ ] Pure/tested modules import zero prisma.
- [ ] Every mutation an agent makes is DRAFT/held until a human commits it.
- [ ] New engines ship in shadow behind a flag.
- [ ] Webhook-driven writes are idempotent by construction.
- [ ] **Ship the action with the insight — no read-only dead-ends.**
- [ ] Mutable-state lists are realtime by default.
- [ ] Keep the go-live blocker list (unit normalization, recipe import) explicit.

## Known go-live blockers (explicit, so we stop building around them)

1. **Unit normalization.** StockBalance is fragmented by `productPackageId` with
   mixed package/base units and no normalization layer. Reorder math, consumption,
   and variance all paper over this with per-call `conversionFactor` reads. Until
   there's a single base-unit truth, every new calc re-derives it and risks drift.
2. **Recipe/BOM import.** Consumption (expected usage) can't go live without
   complete BOMs; menu items without recipes silently drop from variance.
3. **Double-receiving idempotency at the GRN layer.** Receiving doesn't yet guard
   a PO line from being received twice, and short deliveries drop the shortfall
   need (no re-order) — the physical-world twin of the OOS re-source we just built.
