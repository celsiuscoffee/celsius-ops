# Nightly-loop checker rubric

This is **loop 2** from the Loop Engineering masterclass — the rubric a separate
model gates completion against. The `checker` agent scores every candidate fix
against all nine criteria. **A candidate ships only if every criterion passes.**
Each is binary (pass/fail) with a one-line justification; "probably" = fail.

Keep this file short and sharp. A rubric nobody can apply in two minutes is a
rubric that gets skipped.

| # | Criterion | Passes when… |
|---|-----------|--------------|
| 1 | **Solves the finding** | The change addresses the *actual* finding from STATE.md, not a lookalike symptom. |
| 2 | **Minimal** | Only the lines needed for the fix changed. No reformatting, no drive-by edits. |
| 3 | **Tests pass** | The relevant `vitest` tests pass on a fresh run the checker performed itself. |
| 4 | **Types clean** | `tsc --noEmit` for the affected app is green. |
| 5 | **Lint clean** | `eslint` on the touched files is error-free; no new warnings introduced. |
| 6 | **No new `any` ratchet** | No new `// ratchet` / `eslint-disable` markers for `any`. The ratchet only goes down. |
| 7 | **Migration parity** | If `schema.prisma` changed, a matching migration exists under `packages/db/prisma/migrations/`. |
| 8 | **No secrets / no collateral** | No credentials, `.env` values, or files outside the finding's blast radius. |
| 9 | **Reads like a human wrote it** | Naming, imports, and comment density match the surrounding file. |

## Two-tier checking (Module 7: coverage ≠ accuracy)

Criteria 3–7 are **deterministic** — they catch *missing* or *broken* output.
They are blind to *plausible-but-wrong* output (a fix that compiles and passes
tests but does the wrong thing). Criterion 1 and the checker's "blind-spot
check" are the **probabilistic** second tier that closes that gap. Never trust
the deterministic tier alone for a change that touches business logic, money,
inventory counts, or anything customer-facing — escalate those to the triage
inbox rather than auto-approving.

## False-pass discipline

The number that matters is not how many findings the checker *covers* — it's how
often the checker is **right when it passes something**. If you start trusting
this loop unattended, sample its approved PRs by hand for a week and track the
false-pass rate. A confident-but-wrong checker is worse than no loop at all.
