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

## Eval loop (the compounding part)

`fin_agent_decisions` rows with `corrected=true` are ground truth the agent
got wrong. When improving an agent (prompt, context window, threshold):
replay recent corrected rows against the new version before shipping — the
correction rate for that vendor/pattern should drop, and previously-correct
decisions must not flip.

## Lessons

_Append dated entries when this skill misses something. Promote stable ones
into the sections above._
