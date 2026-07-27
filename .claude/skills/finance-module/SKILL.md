---
name: finance-module
description: Work on the agentic finance module (apps/backoffice /finance routes, fin_* tables, the 8 finance agents). Use for any change touching finance code, finance migrations, agent prompts/thresholds, or the exception inbox. Encodes the ledger invariants that must never break.
---

# Finance module — working rules

Canonical spec: `docs/finance-module-spec.md`. The module is the system of
record for Celsius accounting (replaced Bukku). Agents auto-categorize,
auto-match, auto-post; humans only touch the exception inbox.

## Invariants — never break these

DB triggers enforce them, but write code as if they didn't:

1. **Set the actor before any `fin_*` mutation.** Every server-side call:
   `select set_config('app.actor', 'matcher-v1', true)` for agents,
   `set_config('app.actor', :user_id, true)` for humans. The `'system'`
   fallback must never be hit in production — treat it appearing in
   `fin_audit_log` as a bug.
2. **Posted transactions balance.** `sum(debit) = sum(credit)` at
   `status='posted'` (`fin_check_balanced` blocks otherwise).
3. **No posting to closed periods** (`fin_check_period_open`).
4. **COA codes are stable identifiers.** Agents reference sub-account codes
   like `5000-04` (Grabfood) directly in prompts and history. Never renumber
   or reuse a code; deactivate instead.
5. **Don't break the training signal.** Every agent call writes
   `fin_agent_decisions`; exception-inbox corrections update the same row
   (`corrected=true, corrected_to=…`). Any refactor must preserve this
   write path — it is the eval/retraining dataset.

## Agent thresholds (auto-post vs exception)

Categorizer 0.85 · Matcher 0.90 · AP 0.85 · AR 0.95 · Close and Compliance
are manual-approve · Anomaly always files an exception. Changing a threshold
is a product decision — ask, don't tune.

## UI rules

Only 5 routes (`/finance`, `/transactions`, `/inbox`, `/reports`,
`/compliance`). By design there is **no** invoice form, bill form, COA editor,
or manual-journal screen (API-only escape hatch with written reason). Don't
add manual-entry surfaces — the exception inbox is the human path. Every agent
decision exposes its `reasoning` on hover.

## Month-end close

Close agent runs day 1, **manual approve** — never auto-close a period.
Close writes the period snapshot and `fin_period_locks`. Reopening a period
is an exceptional, human-only action.

## Code map (verified 2026-07-05)

- Categorizer: `src/lib/finance/agents/categorizer.ts` — `categorize()` at
  ~L159, `claude-haiku-4-5`, COA system block is prompt-cached; vendor
  context is **last 5 bills** via `supplierHistory()` (~L55), not the 50 the
  spec describes. Version tag `categorizer-v1` (L19).
- Decision logging: `logDecision()` in the same file (~L227) — the ONLY
  `fin_agent_decisions` inserter. Writes `applied:false`; nothing ever
  updates `applied` today.
- Corrections: `recordCorrection()` in `src/lib/finance/inbox.ts` (~L200),
  called from `resolveException()` on genuine overrides only.
- Other agents: `src/lib/finance/agents/{ap,ar,close,compliance,sst,
  ap-verifier}.ts`; matching is rules-based in `lib/finance/ap-match.ts` +
  LLM verifier; **Anomaly agent is not built yet**; nothing writes
  `fin_matches`.
- Inbox API: `src/app/api/finance/exceptions/[id]/resolve/route.ts` →
  `resolveException()` — only `ap`/`categorization` exceptions are
  implemented; others noop.
- Table DDL: `apps/backoffice/supabase/migrations/002_finance_module.sql`
  (~L238) — `fin_agent_decisions` is SQL-managed, NOT in Prisma; access via
  `getFinanceClient()` (service-role Supabase), not Prisma.

## Eval loop (the compounding part)

`fin_agent_decisions` rows with `corrected=true` are ground truth the agent
got wrong. When improving an agent (prompt, context window, threshold):
replay recent corrected rows against the new version before shipping — the
correction rate for that vendor/pattern should drop, and previously-correct
decisions must not flip.

Concrete replay recipe for the categorizer:
1. Pull the set: `select * from fin_agent_decisions where agent='categorizer'
   and corrected order by created_at desc` (partial index exists on
   `corrected`). `input` jsonb holds supplier_name/id, total, line_items,
   outlet_hint — enough to re-call `categorize()` (only `contextNotes` is
   missing).
2. Re-run each through the candidate agent version; compare
   `output.account_code` (snake_case) against `corrected_to.accountCode`
   (camelCase — mind the shape mismatch).
3. Also replay a sample of `corrected=false` rows — those must NOT flip.
4. Bump `CATEGORIZER_VERSION` when shipping so cohorts are comparable.

**Data-quality caveats before trusting the replay set** (see STATE.md open
failures): corrections are attached to the *latest* categorizer decision,
not the matching one (`inbox.ts` ~L215 — known concurrency mis-attribution);
`related_id` is never populated; `applied` is always false. Fixing
attribution (populate `related_id` at decision time, join on it in
`recordCorrection`) is the highest-leverage prerequisite for the eval loop.

## Lessons

_Append dated entries when this skill misses something. Promote stable ones
into the sections above._

- 2026-07-20 — **Staff pay-and-claim is a first-class AP pattern, not a
  mismatch.** Staff frequently pay a vendor out of pocket and get reimbursed,
  so the bank line shows the STAFF NAME (often with an outlet prefix, e.g.
  "Putrajaya ARIFF IZHAM BIN ABD*"), not the vendor. The invoice IS settled.
  The AP verifier (`ap-verifier.ts`, now `ap-verifier-v2`) loads active staff
  names and flags these as `pay_and_claim` → routed to the human finance queue,
  NOT rejected as a wrong match and NOT auto-cleared (fuzzy name match is too
  weak to auto-post money). `fin_agent_decisions.output` now carries
  `pay_and_claim` + `paid_by` for the eval loop. Owner-facing: these post a
  "staff pay-and-claim" handoff on the pulse feed, never the "stopped a wrong
  match" correction.
