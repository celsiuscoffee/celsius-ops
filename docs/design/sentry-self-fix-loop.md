# Sentry self-fixing loop

_2026-07-11 — design note for the upgraded `sentry-triage` skill._

## Goal

Close the loop on production errors: today the nightly routine can *find*
issues and open draft-PR fixes, but nothing ever checks whether a merged fix
actually worked, resolves the Sentry issue, or notices that a "fix" didn't
take. The weekly Sentry email (3.4k errors, issues sitting "Ongoing" for
weeks) is the symptom.

## Shape

One issue's lifecycle, spread across nightly runs (fresh session each run):

| State | Where it's recorded | Transition |
| --- | --- | --- |
| Detected | Sentry (new/regressed/escalating) | classified on the next run |
| Fix proposed | Draft PR, branch `claude/sentry-fix-<shortid>` | human merges (or closes) |
| Deployed | PR merged → Vercel auto-deploy (or OTA for native apps) | verified next run |
| Verified | 0 events since merge+30min → issue resolved in Sentry, comment links the PR | done |
| Retry | events continued after attempt 1 → `-r2` branch, deeper analysis (Seer) | one retry max |
| Escalated | 2 failed attempts, or payments/payroll/`fin_*`, or needs schema change → `docs/STATE.md → Open failures` | human owns it |

Design choices, and why:

- **State lives in GitHub + Sentry, not a repo ledger.** Runs are fresh
  sessions; a ledger file would need commits to `main` outside PRs and would
  drift. Branch-name convention (`claude/sentry-fix-<shortid>`) makes state
  reconstructable with one PR search; attempt count = number of PRs with
  that prefix. Sentry issue status carries the "verified" bit.
- **Per-issue PRs** (the old skill batched one PR per run): revert isolation,
  and the PR ↔ issue link is what makes verification and resolution
  mechanical.
- **Humans stay the merge gate.** The loop proposes; drafts only. "Self-
  fixing" means nobody has to diagnose, patch, or remember to verify —
  the only human action left is reviewing a small diff and pressing merge.
- **Caps everywhere:** ≤3 new fix PRs per run, ≤2 attempts per issue,
  14-day PR lookback. A wrong fix retried forever is worse than an open bug.

## Guardrails (inherited + new)

- Payments, payroll, `fin_*` posting logic: never auto-fixed (hard rule 6).
- Native apps: fix PRs allowed but flagged — merge = OTA production deploy
  (hard rule 5); `pos-native` needs explicit human sign-off.
- No schema changes in this loop (escalate; `db-migration` skill).
- The loop never merges its own PRs, never ignores/resolves an issue that
  wasn't verified quiet after a merged fix.

## Wiring

- **Trigger:** the existing "celsius-ops nightly Sentry triage" routine
  (`trig_01NZbJV3A36TeXRKpBkFjxWx`, cron `0 21 * * *` UTC = 05:00 MYT,
  fresh session per fire). Its prompt defers to
  `.claude/skills/sentry-triage/SKILL.md` on the current branch, so merging
  this PR upgrades the routine with no trigger change.
- **Blocker found 2026-07-11:** the CCR environment egress allowlist does
  not include `sentry.io` → every routine run since 2026-07-04 has no-oped
  at the skill's guard step. Human action: add `sentry.io` / `*.sentry.io`
  to the environment's network settings, then the next 05:00 MYT run goes
  live. Verify any time with `find_organizations`.

## Not in scope (future options)

- **Webhook-driven instant fixes** (Sentry alert → session per issue):
  wait until the nightly loop has a few weeks of good precision first.
- **Deploy correlation** (query Vercel for the exact deploy timestamp
  instead of merge+30min buffer) — worth it only if the buffer produces
  false "still erroring" verdicts.
- **Sentry GitHub integration auto-resolve** ("Fixes SHORTID" in commits):
  redundant with explicit verification, and it resolves at merge time
  rather than after observed quiet — explicitly not wanted.
