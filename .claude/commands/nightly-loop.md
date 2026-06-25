---
description: Run one pass of the nightly maintenance loop (triage → maker → checker → gated PR). Manual entry point; safe to run by hand.
argument-hint: "[--dry-run] [--max N] [finding-id]"
---

# /nightly-loop

You are the **orchestrator** of the nightly maintenance loop for
`celsiuscoffee/celsius-ops`. You design and drive the loop; you do not do the
maker's or checker's job yourself. Read `ops/nightly-loop/README.md` once for the
full design and the failure modes before you start.

Arguments: `$ARGUMENTS`
- `--dry-run` → triage and report only; open NO PRs, write findings to STATE.md.
- `--max N` → attempt at most N findings this pass (default 3).
- a bare `finding-id` → skip triage and run just that finding through maker/checker.

## Procedure

1. **Triage (loop 1).** Invoke the `nightly-triage` skill. It reads CI failures,
   open issues, and recent commits, dedupes against memory, and writes the Open
   findings list to `ops/nightly-loop/STATE.md`. Honour its punts.

2. **Pick work.** Take the top `--max` findings, ordered lowest-risk-first. If
   `--dry-run`, stop here and report the findings + punts. Otherwise continue.

3. **For each finding, run the inner loop:**
   a. **Isolate.** Create a git worktree / branch per finding so parallel work
      can't collide: `git worktree add ../loop-<id> -b loop/<id>`.
   b. **Maker.** Launch the `maker` sub-agent with the finding. It returns a
      candidate diff + local-check evidence (or a PUNT).
   c. **Checker.** Launch the `checker` sub-agent — independent context — with
      the maker's diff. It re-runs the checks itself and scores the rubric
      (`ops/nightly-loop/rubric.md`).
   d. **/goal gate.** Ship only if the checker returns **PASS** *and* the
      verifiable stop condition holds: relevant tests pass AND the affected app
      lints clean AND typechecks, with the diff confined to the finding.
      - **PASS** → open a PR (`mcp__github__create_pull_request`) from `loop/<id>`
        to `main`, title `loop: <finding>`, body linking the source (CI job /
        issue) and pasting the checker's evidence. Move the finding to **Done**
        in STATE.md. **Do NOT merge** — a human reviews. (Module 7: stay the
        engineer who could have written it.)
      - **FAIL** → feed the checker's FEEDBACK FOR MAKER back to the maker and
        retry. Cap at **2 retries** per finding; after that, punt it to
        `triage-inbox.md` + STATE.md "Punted" with the checker's reason.
   e. **Clean up** the worktree: `git worktree remove ../loop-<id>`.

4. **Cost & safety ceilings (hard stops — Module 7):**
   - Never exceed `--max` findings in one pass.
   - Never retry a single finding more than twice.
   - Never push to `main`, never merge, never enable the disabled workflow.
   - If a check loops against a clearly broken environment (e.g. a test
     infra/DB error, not a code error), STOP that finding and punt it — do not
     burn cycles retrying. Record the broken env in STATE.md notes.

5. **Update memory & report.** Write STATE.md (Open / In progress / Done /
   Punted / notes). Print the morning report: findings seen, PRs opened (with
   links), findings punted (and why), and anything the next run should know.

## The one rule
The `checker` sub-agent and the /goal gate are the only things making this safe
to run without a human. Never let the maker approve its own work, never skip the
gate to "save a step." Autonomy minus verification equals industrialised error.
