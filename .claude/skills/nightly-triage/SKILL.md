---
name: nightly-triage
description: >-
  Loop 1 of the nightly maintenance loop. Reads recent CI failures, open issues,
  and recent commits for celsiuscoffee/celsius-ops, then writes a deduplicated
  list of small, worth-doing findings into ops/nightly-loop/STATE.md. Use at the
  start of a nightly-loop run, before any maker/checker work. Triage only — it
  diagnoses and records, it never fixes.
---

# Nightly triage

You are the **triage** step (loop 1) of the nightly maintenance loop. You turn
the repo's recent signal into a short, deduplicated, prioritised findings list in
`ops/nightly-loop/STATE.md`. You **do not fix anything** — you read, diagnose,
and record. The maker/checker handle fixes downstream.

## 1. Read memory first
Open `ops/nightly-loop/STATE.md`. Note what is already Open, In progress, Done,
or Punted, and the "Notes for next run" (known-flaky tests, broken environments,
dead ends). **Never re-surface a finding already Done or Punted** unless it has
clearly regressed.

## 2. Gather signal (last ~24h, or since last run)
Use the GitHub MCP tools (`mcp__github__*`) scoped to `celsiuscoffee/celsius-ops`:

- **CI failures** — recent failed workflow runs on `main` and open PRs
  (`actions_list`, `actions_get`, `get_job_logs`). Capture the failing job, the
  app, and the first real error line (not the stack tail).
- **Open issues** — `list_issues` / `issue_read`. Favour ones labelled bug,
  flaky, chore, or good-first-issue; skip anything needing a product decision.
- **Recent commits** — `list_commits` on `main`. Look for follow-up TODOs, a
  revert that left dead code, or a commit message promising a fix that didn't
  land.

If a tool is unavailable in this run (e.g. headless cron without interactive
auth), record that gap in STATE.md "Notes for next run" and proceed with
whatever signal you do have — local `npx vitest run` and `git log` still work.

## 3. Filter to loop-sized work
A finding qualifies only if **all** are true:
- the fix is plausibly small (a few files, no architecture change),
- it has a *verifiable* done-condition (a test goes green, lint/types clean),
- checking the fix is cheaper than producing it (the asymmetry that makes the
  loop worth running — Module A).

Anything failing those → write it to `triage-inbox.md` and the "Punted to human"
section, with a one-line reason. **Bias toward punting.** A short, correct
findings list beats a long, ambitious one.

## 4. Write findings to STATE.md
Update the **Open findings** table: stable `id` (e.g. `f-2026-06-25-01`), the
finding in one line, source (CI job / issue # / commit sha), first-seen date,
attempt count, status `open`. Refresh "Last run" and add anything future runs
should know to "Notes for next run". Keep Done to ~last 20; prune older rows.

## 5. Hand off
Report a compact summary: how many findings opened, how many punted, and the
ordered list of finding ids the orchestrator should send to the maker. Order by
**lowest risk × highest certainty first** — earn trust before spending it.

> Triage writes to STATE.md, which is the loop's memory. That write is itself a
> state mutation, so be conservative: a wrong finding wastes a whole maker/checker
> cycle and can mislead tomorrow's run.
