---
name: housekeeping
description: Repo housekeeping loop — find and remove unnecessary things (dead code, stale config, docs drift, repo clutter) with evidence, via small draft PRs. Use when asked to tidy/clean up the repo, when the scheduled housekeeping routine fires, or after a decommission leaves debris behind. Never deletes anything it cannot prove dead.
---

# Housekeeping loop

Design doc: `docs/design/housekeeping-agent.md`.

The prime directive: **things that look dead are sometimes load-bearing.**
(`staff-token.ts` looked like retired staff-web debris but powers
pickup-native collect; the Finance "Legacy" nav group turned out to be the
actively-maintained cash lens.) So this loop deletes only on positive
evidence, and everything below the evidence bar becomes a *proposal* for
the owner, never an action.

The loop, one item's lifecycle across runs:

```
sweep → classify (safe / propose-only / human-only)
  → safe: evidence check → draft PR (evidence in body) → [human merges]
  → next run: confirm merged PRs caused no CI/Sentry fallout, then
    pick up the next backlog items
```

Sessions are fresh each run, so **all loop state lives in GitHub + the
backlog below** — branch convention `claude/housekeep-<slug>`, one theme
per PR. Attempted-and-rejected ideas (closed-unmerged PRs) are dead:
record why in *Lessons* and never re-propose.

## Sweep categories

1. **Stale config** — entries pointing at retired apps/paths: launch
   configs, root `package.json` scripts, tsconfig/turbo references, env
   examples, CI steps for things that no longer exist.
2. **Dead code** — unreferenced files/exports/routes/components,
   debris from decommissions (grep STATE.md for "dead", "retired",
   "remove on next touch"). Detector leads: `npx knip` / `npx depcheck`
   per app — treat output as *leads to verify*, never as proof.
3. **Unused dependencies** — package.json deps with zero imports in that
   workspace. Verify against dynamic requires and next.config/babel/expo
   plugin references before removing.
4. **Docs drift** — docs describing retired systems or superseded
   behaviour. Prefer a dated "Superseded by X" banner over deletion;
   `docs/design/` retrospectives are history, leave them alone.
5. **STATE.md compaction** — its own header mandates it: promote stable
   facts into CLAUDE.md/skills/docs, delete what was promoted, collapse
   resolved failures. This is the one place deletion is the default.
6. **Repo clutter** — accidentally committed scratch/generated files,
   fully-merged `claude/*` branches (propose deletion in the summary;
   never delete branches yourself, never touch branches with unmerged
   commits).
7. **Lint ratchet** — `any`-suppression markers are "reduce, never add"
   (grep `"ratchet: reduce, never add"`). Opportunistic: only in files a
   PR already touches, or as a dedicated small PR when a marker's fix is
   mechanical.

## Evidence bar for deletion

A deletion PR must show, in its body:

- **Zero references**: grep across the WHOLE repo — including the
  out-of-workspace `apps/pos-native` and `apps/pickup-native`, and
  `tools/print-bridge` — for the file path, exported symbols, and (for
  routes) the URL path string *and* plausible string-built variants.
- **No external callers**: URL routes need extra care — check
  `vercel.json` crons, webhook registrations, the native apps' fetch
  calls, and `qa_*`/monitoring configs before declaring a route dead.
- **History check**: `git log --follow` on the file — if it was recently
  added or is referenced in an open PR, leave it.
- If any leg of the evidence is unobtainable → downgrade to propose-only.

## Classification

- **Safe (draft PR allowed):** stale config, docs banners, dead code
  meeting the full evidence bar, unused devDeps, STATE.md compaction,
  ratchet reductions. Cap: **3 PRs per run**, each one theme, each small
  enough to review in minutes.
- **Propose-only (list in run summary, take no action):** anything
  database-side (dead tables, old `supabase/migrations`, edge functions,
  the idle `celsius-inventory` Supabase project), Vercel/infra config,
  runtime-behaviour changes disguised as cleanup (e.g. removing the
  pickup dashboard inventory tab — that's a product decision), deleting
  git branches, anything where evidence is partial.
- **Human-only (re-surface, never touch):** payments/payroll/`fin_*`
  (hard rule 6), production DB objects (hard rule 1), secrets/token
  rotation items.
- **Native apps** (`pos-native`, `pickup-native`, `staff-native`): PRs
  allowed for provably-dead code only, and the body must state that
  merging is an OTA production deploy (hard rule 5, `ota-release` skill);
  `pos-native` needs explicit human sign-off (hard rule 6).

## Procedure (per run)

1. **Close the loop:** search PRs with head prefix `claude/housekeep-`
   (last 30 days). Open drafts → pending, leave them. Merged → check the
   on-merge main CI run passed; if it broke, fixing that IS this run.
   Closed unmerged → record the rejection in Lessons, drop the idea.
2. **Sweep** the categories above. Start from the backlog; add fresh
   finds from detectors + STATE.md decommission notes.
3. **Verify** every candidate against the evidence bar.
4. **Ship** up to 3 draft PRs off latest `origin/main`, branch
   `claude/housekeep-<slug>`, title `chore(<area>): <what> [housekeep]`.
   Gate before push: `npx tsc --noEmit` per touched app, `npx eslint .`
   where the app has lint, `npm test` from root, `npx next build` if the
   deletion could affect the build graph. Update the backlog + STATE.md
   inside the same PR.
5. **Summarise:** shipped PRs, propose-only list (with evidence so the
   owner can decide fast), human-only reminders still outstanding.

## Backlog

_Verified candidates, in priority order. Prune entries when their PR
merges; add dated entries as sweeps find more._

- 2026-07-14 — `.claude/launch.json`: `inventory`, `loyalty`, `pos`
  entries point at apps that no longer exist (documented as stale in
  CLAUDE.md since 07-04). Fix the file, then delete the stale-entry
  notes from CLAUDE.md and STATE.md in the same PR. **Safe.**
- 2026-07-14 — root `package.json`: `typecheck:apps` references dead
  `apps/loyalty` (script fails as written); `db:push` / packages/db
  `push` script is a loaded footgun given hard rule 1 — remove the
  scripts, note the removal in the PR body for owner veto. **Safe.**
- 2026-07-14 — staff-native dead AI-coach helpers (coach card hides on
  fetch failure; server side deleted in the sentry-loop PR). STATE.md
  says "remove on the next staff-native touch" — bundle with the next
  staff-native PR rather than a standalone OTA. **Safe, ride-along.**
- 2026-07-14 — STATE.md compaction: 2026-07-04/05 entries whose facts
  are now in CLAUDE.md or skills; resolved-failure paragraphs. **Safe.**
- 2026-07-14 — pickup dashboard inventory tab reads tables that exist in
  neither Supabase project (silently empty since ever). Remove vs rewire
  is a product call. **Propose-only.**
- 2026-07-14 — dead DB tables (`SalesTransaction`, `fin_bank_transactions`,
  `fin_invoices`, `fin_bills`) + 3 tombstoned edge functions + Telegram
  QA bot token rotation + idle `celsius-inventory` Supabase project.
  **Human-only; re-surface in every summary until done.**

## Lessons

_Append dated entries when this skill misses something, and every
rejected (closed-unmerged) housekeeping PR with the why. Promote stable
ones into the sections above._
