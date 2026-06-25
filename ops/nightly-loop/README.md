# The nightly maintenance loop

A "night shift" for `celsius-ops`: an agentic maker/checker loop that, once
enabled, reads the repo's recent signal each night, drafts small fixes, has an
independent reviewer gate them, and opens PRs for a human to merge. It is the
concrete artifact from **Module 6 of the Loop Engineering masterclass** — built
here for this repo, and currently **shipped disabled** (see [Enabling it](#enabling-it-depth-before-autonomy)).

> **The thesis:** you design this loop *once* and then never prompt the steps
> again. The only thing standing between "useful autonomy" and "industrialised
> error" is the **checker** + the **/goal gate**. Never remove them.

## The shape

```
 GitHub Action (manual today; daily 06:00 MYT when enabled)
   └─ nightly-triage SKILL ........... loop 1: reads CI failures + open issues
   │                                    + recent commits → writes STATE.md
   for each finding worth doing (lowest-risk first, capped at --max):
      ├─ isolated git WORKTREE ........ no collisions between parallel fixes
      ├─ maker SUB-AGENT .............. drafts the minimal fix + local evidence
      ├─ checker SUB-AGENT ............ independent context; re-runs checks,
      │                                  scores rubric.md  (loop 2: verification)
      └─ /goal GATE: tests pass AND lint clean AND types clean AND scope-confined
            ├─ PASS → open PR (never merge) · move finding to Done in STATE.md
            └─ FAIL → feedback ↩ maker (≤2 retries) → else punt to inbox
   anything too big / ambiguous / risky → triage-inbox.md   (for you)
   STATE.md remembers what was tried / passed / still open → tomorrow resumes
```

## The four nested loops (and where each lives)

| Loop | Job | In this repo |
|------|-----|--------------|
| 1 · **agent** | does the work | `maker` sub-agent + `nightly-triage` skill |
| 2 · **verification** | makes it correct | `checker` sub-agent + `rubric.md` + the /goal gate |
| 3 · **application** | embeds in the world | the GitHub Action + PRs into `main` |
| 4 · **hill-climbing** | improves the system | you, reading STATE.md / inbox and tuning the rubric & skill |

## The one rule: maker ≠ checker

The [`maker`](../../.claude/agents/maker.md) writes code and **never** approves
its own work. The [`checker`](../../.claude/agents/checker.md) has a different
context and read-only tools, and is rewarded for finding reasons *not* to ship.
A checker that rubber-stamps is worse than no checker — it manufactures false
confidence and poisons tomorrow's memory. This separation is the entire safety
model.

## Files

| File | Role | Loop |
|------|------|------|
| `.claude/skills/nightly-triage/SKILL.md` | reads signal → findings | 1 |
| `.claude/agents/maker.md` | drafts the fix | 1 |
| `.claude/agents/checker.md` | independent reviewer | 2 |
| `ops/nightly-loop/rubric.md` | the 9-criteria pass/fail gate | 2 |
| `.claude/commands/nightly-loop.md` | `/nightly-loop` orchestrator (manual entry) | 3 |
| `.github/workflows/nightly-loop.yml` | the automation (disabled) | 3 |
| `ops/nightly-loop/STATE.md` | memory across runs | 5 |
| `ops/nightly-loop/triage-inbox.md` | what the loop punts to you | — |

## Running it by hand

From Claude Code in this repo:

```
/nightly-loop --dry-run      # triage only — see what it would do, no PRs
/nightly-loop --max 1        # attempt one finding end-to-end (opens a PR)
/nightly-loop f-2026-06-25-01  # run one specific finding through maker/checker
```

Start with `--dry-run`, read `STATE.md`, then graduate to `--max 1`.

## Enabling it (depth before autonomy)

The masterclass's on-ramp, in increasing order of autonomy. Do them in order;
do not skip ahead.

1. ✅ **Rubric exists** (`rubric.md`) — loop 2 in its simplest form.
2. **Run under the /goal gate by hand.** `/nightly-loop --max 1`; watch the
   `checker` gate completion. Do this several times.
3. ✅ **Checker sub-agent exists** (`.claude/agents/checker.md`) with different
   instructions from the maker. Confirm it actually fails bad diffs.
4. ✅ **State lives on disk** (`STATE.md`); each run reads it first.
5. **Only then add automation.** Add the `ANTHROPIC_API_KEY` repo secret, run
   the workflow via *Actions → nightly-loop → Run workflow* in `dry-run`, read
   the result, then `live`. When you trust it, uncomment the `schedule:` cron in
   `.github/workflows/nightly-loop.yml`.

**Before you trust it unattended,** sample its approved PRs for a week and track
the checker's **false-pass rate** (how often it passes something wrong). That
number — not coverage — decides whether this loop is safe to leave alone.

## What breaks first (watch these — Module 7)

- **Compounding error into state.** A wrong fix that lands in `STATE.md` makes
  tomorrow build on it. → the maker/checker gate guards every write; treat
  STATE.md as production data.
- **Coverage ≠ accuracy.** Green tests ≠ correct. → the checker's blind-spot
  check + criterion 1 are the probabilistic second tier; risky domains get
  punted, not auto-approved.
- **Plausible garbage.** Deterministic checks miss plausible-but-wrong output. →
  anything touching money / inventory / customer-facing behaviour goes to the
  inbox.
- **Unattended cost.** → 30-min job timeout, `--max` cap, ≤2 retries, and "stop
  on broken environment" in the orchestrator.
- **Cognitive surrender.** The loop never merges. **Read every PR it opens.**
  Stay the engineer who could have written it.
