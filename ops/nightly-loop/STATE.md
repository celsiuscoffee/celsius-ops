# Nightly-loop STATE

> **This file is the loop's memory** — the across-session outer loop (Module 5).
> Each run reads it FIRST, resumes from here, and writes findings back. Treat it
> as production data, not scratch: a maker/checker gate guards every write, so a
> bad fix can't silently poison tomorrow's run.
>
> Format is intentionally plain Markdown so a human can read the morning report
> at a glance. The orchestrator (`/nightly-loop`) maintains the sections below.

_Last run: never (seeded by setup). Status: loop is DISABLED — see README._

## Open findings
_Things triage surfaced that are worth doing but not yet fixed._

| id | finding | source | first seen | attempts | status |
|----|---------|--------|-----------|----------|--------|
| —  | _(none yet — the first run will populate this)_ | | | | |

## In progress
_Findings a maker is currently drafting / a checker is reviewing._

_(none)_

## Done (recent)
_Findings that passed the checker and shipped as a PR. Keep ~last 20; prune older._

| id | finding | PR | shipped |
|----|---------|----|---------|
| —  | _(none yet)_ | | |

## Punted to human
_Findings the loop deliberately did NOT attempt (too large, ambiguous, risky).
Mirror of `triage-inbox.md` — see that file for full context._

_(none)_

## Notes for next run
_Free-form memory: broken test environments to avoid, known-flaky tests, things
tried that didn't work, anything that would waste tokens to rediscover._

- (seed) On the very first enabled run, start in **dry-run**: triage and write
  findings here, but open NO PRs until a human has reviewed this file once.
