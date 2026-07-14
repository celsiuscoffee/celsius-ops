---
name: housekeeping
description: Repo housekeeping loop — find and remove unnecessary things (dead code, stale config, docs drift, repo clutter) with evidence, via small draft PRs; plus a monthly utility audit for zombies (working-but-unused / purpose-defeating features) that produces owner decision memos. Use when asked to tidy/clean up the repo, run the utility audit, when the scheduled housekeeping routine fires, or after a decommission leaves debris behind. Never deletes anything it cannot prove dead.
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
8. **Zombies (utility audit)** — working but unused, or defeating the
   objective they were built for. Different evidence, different verdicts,
   different cadence — see its own section below.
9. **Off-repo surfaces** — clutter lives on the platforms too, and it's
   the most dangerous kind (the retired loyalty/inventory/pos Vercel
   projects still *existing* is what let `qa-autofix` redeploy them for
   months). Sweep via MCP, **propose-only** (infra): Vercel projects +
   their env vars vs what the code actually reads; Supabase edge
   functions (3 tombstones pending dashboard delete) + `cron.job` rows
   + the idle `celsius-inventory` project; scheduled routines/triggers
   vs the skills they defer to; Meta WhatsApp templates vs senders in
   code; stale `claude/*` branches and long-idle draft PRs.

## Decommission protocol

Most clutter in this repo is the residue of *partial* retirement — the
April QA monitor survived three months because the apps were retired
but their monitor, crons, edge functions, Vercel projects, and bot
token were not. **Retire systems, not files.** When this loop (or any
session) decommissions something, one PR/change-set must cover, or
explicitly hand to a human, every layer:

- [ ] code + config/env references (all apps, incl. out-of-workspace)
- [ ] crons: `vercel.json` AND `pg_cron` on both Supabase projects
- [ ] edge functions / webhooks / external registrations (Meta
      templates, Telegram bots, GBP wiring)
- [ ] platform projects & env vars (Vercel, Supabase) — propose
- [ ] secrets the thing held — rotation goes on the human list
- [ ] monitoring, alerts, scheduled routines watching it
- [ ] docs banner + STATE.md + this skill's backlog/register

The code sweep audits *recent* decommissions (STATE.md is the log)
against this checklist and files the leftovers as backlog items.

## Utility audit — working but unused

Grep-evidence finds *dead* things; it cannot find **zombies**: code that
is referenced, runs green, and delivers nothing — or actively works
against the objective. The April QA monitor was the archetype: a healthy
cron with 4,200 consecutive runs of pure harm (redeploying retired
Vercel projects). Zombies are found with **usage/outcome evidence**, and
because they still run, every verdict here is **propose-only** — the
output of this sweep is a decision memo, never a deletion PR.

Zombie shapes to hunt (each has a live precedent in this repo):

- **Producer without a consumer** — a cron/agent computes or writes
  something no code reads and no human acts on. Detect: for each
  vercel.json cron and agent output table, find the reader (code path or
  documented human ritual). Writes continuing + zero readers = zombie.
- **Shadow/disabled limbo** — flags and hard-disabled paths past their
  decision date: shadow modes never armed, features "temporarily" off.
  Limbo has all the maintenance cost and none of the benefit; each item
  is *arm or kill*, never "leave it". Detect: grep for shadow/disabled/
  `MODE=`/hard-disabled markers + the dated notes in STATE.md.
- **Half-built loop** — data faithfully collected for a consumer that
  was never built (spec'd agents that don't exist, resolvers that noop).
  The collection cost is real; the promised value is zero.
- **Purpose-defeaters** — things whose behaviour contradicts the
  objective or a hard rule: UI that promises an action which noops
  (finance exception types without resolvers), metrics that mislead
  (draft payroll runs flattering FT actuals), duplicate lenses where one
  is a strict superset (the Ops Dashboard/Performance precedent).

**Evidence bar (usage, not references):** who/what consumes the output —
code reader, downstream cron, or a named human ritual; last-write vs
last-read; execution logs (Vercel/cron) confirming it actually runs;
and the STATE.md/docs paper trail — distinguish **consciously parked**
(a pending human decision, with owner and date) from **forgotten**.
If consumption can't be established either way, say so in the memo —
"unknown consumer" is a finding, not a license to kill.

**Verdicts** (owner picks; the agent executes only after the pick):

- **Arm/finish** — turn it on or build the missing consumer; often the
  right call and the opposite of deletion.
- **Kill** — decommission fully: code + cron + flags + docs in one PR,
  so no new debris (the QA monitor lesson: retire *systems*, not files).
- **Park with expiry** — legitimate wait on a human/external step gets
  an owner and a revisit date in the memo; it is re-surfaced every
  sweep until armed or killed, so limbo can't become permanent.
- **Keep** — recorded with the reason in the zombie register below so
  it is never re-flagged (the "Cash ≠ Legacy" lesson).

**Cadence:** heavier than the code sweep — run as every **4th** weekly
run (~monthly) or on demand ("run the utility audit"). Deliverable is
one decision memo (issue or summary comment), not PRs.

## Zombie register

_Known zombies + past verdicts. Seeded from STATE.md 2026-07-14; the
utility audit maintains this list._

- Consumption engine **shadow-only** (reorder ignores sales); arming
  needs unit normalisation + recipe import. Parked since 2026-07-04 —
  needs owner + expiry. **Shadow limbo.**
- `LABOUR_VARIANCE_MODE=shadow` — "flip after one sane Monday"
  (2026-07-05); several Mondays have passed. **Shadow limbo, likely
  ready to arm.**
- PDF cold-send hard-disabled + `invoice_request` template never
  submitted to Meta (one owner visit). **Parked on human; nag.**
- Six 2026 payroll runs stuck in `draft` — flattering FT actuals until
  closed. **Purpose-defeater; human-only (hard rule 6).**
- Finance exception types other than `ap`/`categorization` **noop on
  resolve**; Anomaly agent from the spec never built, nothing writes
  `fin_matches`. **Half-built loop:** build the resolvers or stop
  offering resolve on those types.
- SMS attribution holdout: loop built, stalled since 2026-07-05 on two
  owner decisions (reward + success bar). **Parked on human; nag.**
- Nav items `hidden` in round 4 (Recipe Cards, Points Log, Outcome
  Types, Settings Hub, Ops Dashboard): hidden-but-maintained; next
  audit proposes kill vs keep per page with reachability/usage
  evidence. **Candidate zombies.**
- KEEP (do not re-flag): Finance "Cash" group (ex-"Legacy") — verified
  actively-maintained cash-basis lens, 2026-07-11.

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
   finds from detectors + STATE.md decommission notes. Every 4th run
   (or on request) run the **utility audit** instead — its deliverable
   is the decision memo, not PRs.
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
