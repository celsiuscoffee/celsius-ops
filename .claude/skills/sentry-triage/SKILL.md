---
name: sentry-triage
description: Sentry triage + self-fixing loop for the Celsius apps. Use when asked to check errors/monitoring, when a Sentry alert comes in, or as the procedure for the scheduled nightly routine. Sweeps issues, ships draft-PR fixes for mechanical ones, then on later runs verifies merged fixes against live Sentry data and resolves or retries.
---

# Sentry triage & self-fixing loop

Sentry MCP server is configured in `.mcp.json` (token via env). Monitoring
context: `docs/monitoring-setup.md` — every app exposes `/api/health`;
Vercel crons fail silently into logs unless heartbeat-monitored, so a
"quiet" cron is not evidence it's healthy.

Design doc: `docs/design/sentry-self-fix-loop.md`.

The loop, one issue's lifecycle across runs:

```
sweep → classify → fix branch → draft PR → [human merges + Vercel deploys]
  → next run: verify in Sentry → quiet? resolve issue (link PR)
                               → still erroring? retry once (deeper analysis)
                               → retried already? escalate to STATE.md, stop
```

Sessions are fresh each run, so **all loop state lives in GitHub + Sentry**,
never in a repo file:

- One branch + draft PR **per issue**, branch `claude/sentry-fix-<shortid>`
  (lowercase Sentry shortId, e.g. `claude/sentry-fix-celsius-ops-1a2b`);
  retry attempt appends `-r2`. The PR title/body must contain the shortId.
- Attempt count for an issue = number of PRs (any state) whose head branch
  starts with `claude/sentry-fix-<shortid>`. **Hard cap: 2 attempts.**
- A verified fix is recorded by resolving the Sentry issue with a `reason`
  comment linking the merged PR (`update_issue status=resolved`).

## Procedure (per run)

1. **Guard:** call `find_organizations`. If Sentry tools are unavailable,
   unauthenticated, or you get `403 Host not in allowlist: sentry.io`, stop —
   report that (it's an environment egress/network-settings problem, not a
   code problem) and change nothing.
2. **Verify previous fixes (close the loop):** search GitHub PRs with head
   branch prefix `claude/sentry-fix-` updated in the last 14 days.
   - **Open draft** → still waiting on a human merge; list as pending in the
     summary, do nothing else.
   - **Merged** → look up the Sentry issue. Count events since merge time
     + 30 min (deploy buffer). Zero events → `update_issue status=resolved`
     with a reason linking the PR. Still erroring → if this was attempt 1,
     open a retry (`-r2`) with deeper analysis (read the full event,
     breadcrumbs, consider `analyze_issue_with_seer`); if attempt 2 already
     happened, append to `docs/STATE.md → Open failures` with the Sentry
     link + both PRs and stop retrying — a human owns it now.
   - **Closed without merge** → a human rejected the approach; treat as
     escalated, do not reopen.
3. **Sweep:** new + regressed + escalating issues since the last run
   (default 24h), across all Celsius projects. Note event counts and
   affected users.
4. **Prioritise by business impact:** POS/till (`pos-native`) and order flow
   (`order`, payment/reconcile crons) first — they lose money per minute;
   backoffice/staff issues can wait for a human.
5. **Classify each issue:**
   - **Mechanical + confident** (null guard, missing await, bad import,
     obvious regression from a recent commit): run the fix protocol below.
     Cap: **3 new fix PRs per run** — beyond that, list the rest in the
     summary for the next run.
   - **Real but non-trivial:** append to `docs/STATE.md → Open failures`
     with the Sentry link, first-seen date, and a hypothesis.
   - **Noise/known:** skip, but if it's recurring noise, propose a Sentry
     ignore rule or a `beforeSend` filter in the summary — never silently
     ignore an issue in Sentry yourself.
6. **Fix protocol (per issue):**
   - Branch `claude/sentry-fix-<shortid>` off latest `origin/main`.
   - Minimal diff. If the stack trace alone isn't conclusive, use
     `analyze_issue_with_seer` before writing code — don't guess.
   - Verify: `cd apps/<app> && npx tsc --noEmit`, plus `npx eslint .` where
     the app has lint, plus `npm test` from root if shared packages changed.
   - Push, open a **draft** PR: title `fix(<app>): <summary> [<SHORTID>]`,
     body with the Sentry issue link, event/user counts, root cause, and why
     the fix is safe. One issue per PR — never bundle.
   - The loop **never merges its own PRs** and never marks an issue
     resolved before a merged fix has been verified quiet (step 2).
7. **Hard guardrails:**
   - **Never** auto-fix anything touching payments, payroll, or `fin_*`
     posting logic — those always go to Open failures for a human
     (CLAUDE.md hard rule 6).
   - Fixes under `apps/pos-native`, `apps/pickup-native`,
     `apps/staff-native` are allowed as draft PRs, but the PR body must
     state that **merging is an OTA production deploy** (hard rule 5, see
     the `ota-release` skill); `pos-native` additionally needs explicit
     human sign-off per hard rule 6.
   - Schema changes are out of scope for this loop — if a fix needs one,
     escalate to Open failures and reference the `db-migration` skill.
8. **Paperwork:** STATE.md edits ride inside the relevant fix PR. If the run
   produced only notes and no fix, put them in the session summary instead
   of pushing a notes-only commit.

## Cron-health cross-check

While in Sentry, check Cron Monitors (if wired — see monitoring doc §2) for
missed check-ins on: `reconcile-pending` (1 min, order),
`expire-orders` (10 min, order), `attendance-auto-close` (15 min,
backoffice). A missed `reconcile-pending` window is a payments problem —
treat as top priority.

## Ops requirements

- The CCR environment's network egress must allow `sentry.io` (and
  `*.sentry.io`) — Environment settings → network. Without it every run
  no-ops at step 1.
- `SENTRY_ACCESS_TOKEN` must be set in the environment (consumed by
  `.mcp.json`).
- Org slug: `celsius-coffee-sdn-bhd` (region `https://us.sentry.io`).
  Projects: `celsius-ops` (all web apps AND staff-native — native events are
  tagged `app:staff-native` + `dist:staff-native`), `celsius-pickup-native`
  (KDS), `mujtamaos` (separate product, NOT this repo — leave its issues
  alone). Recorded 2026-07-12, first live connect.
- Interactive sessions can also reach Sentry via the claude.ai Sentry
  connector (`mcp__Sentry__*`, OAuth) even when egress is blocked — but
  routine-fired fresh sessions only get `.mcp.json`, so the egress
  allowlist is still required for the nightly loop.

## Lessons

_Append dated entries when this skill misses something. Promote stable ones
into the sections above._

- 2026-07-11 — `sentry.io` was not in the CCR environment egress allowlist,
  so every nightly run since 2026-07-04 stopped at the guard (403 "Host not
  in allowlist"). The weekly email report was the only visibility. Fix is in
  the environment's network settings, not in code — verify with
  `find_organizations` after changing it.
