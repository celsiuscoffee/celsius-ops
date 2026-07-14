# Housekeeping agent — design

2026-07-14. Companion to `.claude/skills/housekeeping/SKILL.md` (the
executable runbook — that file is the source of truth for procedure;
this doc records the why and the shape).

## Problem

Six months of fast building (StoreHub/Bukku replacement, app
consolidations, decommissions) left debris the sessions keep tripping
over: launch configs and package scripts pointing at retired apps, dead
helpers left behind by decommissions ("remove on next touch" notes in
STATE.md), docs describing systems that no longer exist, a STATE.md that
grows monotonically, and a lint-suppression ratchet nobody is winding
down. Each item is small; collectively they cost every session context
and occasionally cause real bugs (the April QA monitor kept redeploying
retired Vercel projects for three months because nobody owned cleanup).

## Shape: skill + scheduled routine, same as the Sentry loop

Three candidate shapes were considered:

1. **One-off cleanup session** — fixes today's list, doesn't stop the
   list regrowing. Rejected as the *only* mechanism; the first run of
   the loop effectively is this.
2. **Multi-agent workflow** (`.claude/workflows/`) — good for parallel
   *detection* fan-out, but detection is cheap here (grep + knip); the
   expensive part is verification and judgment, which doesn't
   parallelise safely. Can be added later for the sweep step if runs
   get slow.
3. **Skill (runbook) + recurring routine, fresh session per run** —
   chosen. Proven by `sentry-triage`: the skill encodes procedure and
   guardrails and accumulates Lessons; a scheduled routine whose prompt
   defers to the skill picks up procedure changes on merge with no
   re-scheduling; fresh sessions force loop state into durable places.

## State model

- **Procedure + backlog** live in the skill file (versioned, reviewed).
- **Work in flight** lives in GitHub: branch prefix `claude/housekeep-`,
  one theme per draft PR, evidence in the PR body. Attempt/rejection
  history is reconstructed from PR search, like the Sentry loop.
- **Cross-session facts** stay in STATE.md, edited inside the PRs.

## Why the evidence bar is the core of the design

This repo's history says the risk isn't deleting too little, it's
deleting something load-bearing: `staff-token.ts` (looked like retired
staff-web debris, powers pickup-native collect), the Finance "Legacy"
group (actively-maintained cash lens, renamed instead of pruned). The
July nav prune worked precisely because every hide was verified
reachable another way first. So the agent's default action on anything
below the full evidence bar is *propose*, and whole classes (database,
infra, payments/payroll, product-behaviour changes) are propose-only or
human-only regardless of evidence. Deletion is cheap to re-propose next
run; an outage is not.

## Second lens: the utility audit (zombies)

Reference-evidence only finds *dead* things. A distinct failure class —
raised by the owner on review — is **working but useless**: referenced,
green in CI, running on schedule, and delivering nothing or actively
defeating its objective. The April QA monitor is the canonical case
(healthy hourly cron, months of harm); softer cases are everywhere:
shadow modes past their arm date, crons writing tables nothing reads,
half-built loops that collect data for a consumer that was never built,
UI that promises actions which noop.

These need a different loop, so the skill defines one:

- **Evidence is usage/outcome, not references** — consumer analysis
  (who reads the output: code, cron, or a named human ritual),
  last-write vs last-read, execution logs, and the STATE.md paper trail
  separating *consciously parked* from *forgotten*.
- **Verdicts are richer than delete/keep**: arm/finish (often the right
  answer — the thing is useless only because it was never switched on),
  kill (decommission the whole system in one PR — code, cron, flags,
  docs), park-with-expiry (legitimate waits get an owner and a revisit
  date, and get re-surfaced every sweep so limbo can't become
  permanent), keep (recorded, never re-flagged).
- **Everything is propose-only.** Zombies still run; whether their
  promise should be kept or killed is a product/owner call. The agent's
  job is the evidence dossier — a monthly decision memo, not PRs.
- **Cadence: every 4th weekly run (~monthly), or on demand.** Usage
  evidence is slow-moving and the memo demands owner attention; weekly
  would train the owner to ignore it.

The skill seeds a **zombie register** from STATE.md (consumption-engine
shadow, labour-variance shadow, draft payroll runs, noop exception
resolvers, stalled SMS holdout, hidden nav pages) including a KEEP
entry (the Finance "Cash" group) so settled questions stay settled.

## Blast-radius controls

- Draft PRs only; the loop never merges its own work.
- ≤3 PRs per run, one theme each, small diffs.
- Full local gate before push (tsc / eslint / vitest / build).
- Native-app PRs flag the OTA consequence (hard rule 5); `pos-native`
  additionally requires human sign-off (hard rule 6).
- Closed-unmerged PR = permanent rejection, recorded in Lessons.

## Cadence & rollout

1. Merge this PR (skill + doc).
2. First run on demand ("run housekeeping") — expected to ship the
   seeded backlog's Safe items (launch.json, package scripts, STATE
   compaction) and produce the first propose-only list.
3. If run 1 is judged useful: schedule a **weekly** routine (Sunday
   morning MYT suggested — the par-recalc cron day, low traffic), fresh
   session per run, prompt deferring to the skill. Weekly, not nightly:
   clutter accretes slowly, and review bandwidth is the real constraint.
4. Revisit after ~4 runs: if sweeps are slow, move detection into a
   `.claude/workflows/housekeeping.js` fan-out; if PRs are mostly
   rejected, tighten the skill's classification instead of arguing.
