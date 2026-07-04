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

## General rules

- Typecheck before pushing — every time. CI enforces it, but catch it locally.
- Never test against the production database; the procurement runbook's seed SQL
  is staging-only.
- When a fix is confirmed working, record *why it worked* here or in the relevant
  skill — not just in the chat.

## Open failures

_None recorded yet. Format:_
- `YYYY-MM-DD — <symptom> — <what was tried> — <current hypothesis> — <blocking?>`

## Lessons learned

- 2026-07-04 — `eas update` shells out to `expo export`, whose interactive
  prompts ignore `--non-interactive`; set `CI=1` in the environment instead.
  Pass commit messages via env var, not inline in the shell command (backticks/
  `*`/newlines get shell-expanded). (Source: `.github/workflows/pos-native-ota.yml`.)

## Resume pointer

- 2026-07-04 — Claude Code harness scaffolding added (this file, root
  `CLAUDE.md`, `.claude/skills/{db-migration,ota-release,procurement-e2e}`).
  Next candidates: a skill for the finance close process
  (`docs/finance-module-spec.md`), a scheduled routine for Sentry triage
  (Sentry MCP already configured in `.mcp.json`), and an eval loop built from
  finance exception-inbox resolutions.
