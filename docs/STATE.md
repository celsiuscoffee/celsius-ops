# STATE — cross-session memory

Working memory for agent sessions on this repo. Read this at the start of every
session; update it before ending one. Keep entries dated, terse, and factual —
delete entries that have been promoted into `CLAUDE.md`, a skill, or a doc.

## Verified facts

- 2026-07-04 — `apps/pos-native` and `apps/pickup-native` sit **outside** the npm
  workspace (own `package-lock.json` each); root `npm ci` does not install them.
- 2026-07-04 — Two migration directories exist: `packages/db/prisma/migrations/`
  (the audit trail CI's migration-guard checks — files are saved, never executed)
  and `supabase/migrations/` (018–070, applied history). Schema of record is
  `packages/db/prisma/schema.prisma`.
- 2026-07-04 — `.claude/launch.json` is partially stale: `inventory`, `loyalty`,
  and `pos` entries point at `apps/` directories that no longer exist.
- 2026-07-04 — Procurement loop: automated PO-send to suppliers over WhatsApp
  (`purchase_order` / `po_approval` buttons) was designed but **never shipped**;
  sending the order block is still manual. Agent only needs an open PO to exist.
  (Source: `docs/design/procurement-e2e-test-runbook.md`.)
- 2026-07-04 — Stock accuracy is shadow-only (consumption engine off); reorder
  runs off receipts − wastage/transfers, not sales. Going live needs unit
  normalisation + recipe import (`docs/design/procurement-qa-2026-06-26.md`).
- 2026-07-05 — RLS coverage is broader than `docs/rls-strategy.md` claims
  (three later migration sets added deny-all/policied RLS to HR, bank, ads,
  and all `fin_*` tables) — but the **loyalty tables' policies are
  `USING (true)` for all roles, so member PII/points are anon-readable AND
  writable**. Full verified map + ranked fixes:
  `docs/rls-access-map-2026-07-05.md`.
- 2026-07-04 — 14 Vercel crons fail silently into logs (no heartbeat
  monitoring wired yet). `reconcile-pending` (order, every 1 min) is the
  payments-critical one. See `docs/monitoring-setup.md`.
- 2026-07-04 — Exception-inbox corrections update `fin_agent_decisions`
  (`corrected=true, corrected_to=…`) — this is the finance agents' eval/
  retraining dataset. Preserve the write path in any refactor.
- 2026-07-05 — Categorizer runs on `claude-haiku-4-5` with a prompt-cached
  COA block; its vendor context is the last **5** bills, not the 50 the
  spec describes (spec drift, `categorizer.ts` `supplierHistory()`).
- 2026-07-05 — The Anomaly agent from the finance spec is **not built**;
  matching is rules-based (`ap-match.ts`) + an LLM verifier — nothing
  writes `fin_matches`. Only `ap`/`categorization` exceptions have a
  resolver; other exception types noop on resolve.

## General rules

- Typecheck before pushing — every time. CI enforces it, but catch it locally.
- Never test against the production database; the procurement runbook's seed SQL
  is staging-only.
- When a fix is confirmed working, record *why it worked* here or in the relevant
  skill — not just in the chat.

## Open failures

- 2026-07-05 — **Correction mis-attribution in the finance eval dataset** —
  `recordCorrection()` (`apps/backoffice/src/lib/finance/inbox.ts` ~L215)
  tags the *most recent* categorizer decision (`order created_at desc,
  take first`) instead of the one belonging to the corrected exception;
  `fin_agent_decisions.related_id` is never populated by `logDecision()`
  (`categorizer.ts` ~L227), so a correct join isn't possible today. Under
  concurrent AP ingestion, corrections land on the wrong rows — silently
  corrupting the retraining/eval set. Fix: populate `related_type`/
  `related_id` at decision time, return the decision id from
  `categorize()`, and join on it in `recordCorrection`. Not blocking
  day-to-day finance ops; blocking for the eval-replay loop.
- 2026-07-05 — `fin_agent_decisions.applied` is written `false` and never
  updated by any code path — can't distinguish auto-posted decisions from
  ignored ones when building eval cohorts.
- 2026-07-05 — **Loyalty tables anon-writable** (`members`, `member_brands`,
  `point_transactions`, `redemptions`): RLS policies in
  `apps/order/supabase/migrations/001_initial_schema.sql:186-195` are
  `USING (true)` with no `TO service_role`. Blocked on: moving the
  backoffice pickup page's browser reads (`(admin)/pickup/page.tsx`
  ~L192-202) behind an API route first, then a policy-fix migration
  (human approval). Ranked plan in `docs/rls-access-map-2026-07-05.md`.

_Format: `YYYY-MM-DD — <symptom> — <evidence> — <hypothesis/fix> — <blocking?>`_

## Lessons learned

- 2026-07-04 — `eas update` shells out to `expo export`, whose interactive
  prompts ignore `--non-interactive`; set `CI=1` in the environment instead.
  Pass commit messages via env var, not inline in the shell command (backticks/
  `*`/newlines get shell-expanded). (Source: `.github/workflows/pos-native-ota.yml`.)

## Resume pointer

- 2026-07-04 — Harness scaffolding rounds 1+2 done: root `CLAUDE.md`, this
  file, skills `{db-migration,ota-release,procurement-e2e,finance-module,
  sentry-triage}`, workflow `.claude/workflows/rls-audit.js`, and a nightly
  Sentry-triage routine scheduled (05:00 MYT, fresh session per run —
  manage via the Routines/triggers list).
  Next candidates: run the `rls-audit` workflow and act on the report;
  build the finance eval replay (corrected `fin_agent_decisions` rows →
  regression set per agent, see finance-module skill); wire cron heartbeat
  monitors (`docs/monitoring-setup.md` §2).
- 2026-07-05 — Both exploration passes done and documented (finance code
  map → finance-module skill; RLS access map →
  `docs/rls-access-map-2026-07-05.md`). Highest-priority next work, in
  order: (1) pickup-page loyalty reads behind an API route, (2) loyalty
  RLS policy-fix migration [approval], (3) `related_id` attribution fix in
  the finance decisions log, (4) `hr_payroll_runs` deny-all migration
  [approval].
