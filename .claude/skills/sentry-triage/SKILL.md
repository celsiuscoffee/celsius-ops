---
name: sentry-triage
description: Triage Sentry issues for the Celsius apps. Use when asked to check errors/monitoring, when a Sentry alert comes in, or as the procedure for the scheduled nightly triage routine. Produces STATE.md entries and draft PRs for mechanical fixes.
---

# Sentry triage

Sentry MCP server is configured in `.mcp.json` (token via env). Monitoring
context: `docs/monitoring-setup.md` — every app exposes `/api/health`;
14 Vercel crons fail silently into logs unless heartbeat-monitored, so a
"quiet" cron is not evidence it's healthy.

## Procedure

1. **Guard:** if Sentry tools are unavailable or unauthenticated, stop —
   report that and change nothing.
2. **Sweep:** new + regressed issues since the last triage (default 24h),
   across all Celsius projects. Note event counts and affected users.
3. **Prioritise by business impact:** POS/till (`pos-native`) and order flow
   (`order`, payment/reconcile crons) first — they lose money per minute;
   backoffice/staff issues can wait for a human.
4. **Classify each issue:**
   - **Mechanical + confident** (null guard, missing await, bad import,
     obvious regression from a recent commit): branch, fix, typecheck the
     affected app, push, open a **draft** PR referencing the Sentry issue.
   - **Real but non-trivial:** append to `docs/STATE.md → Open failures`
     with the Sentry link, first-seen date, and a hypothesis.
   - **Noise/known:** skip, but if it's recurring noise, propose a Sentry
     ignore rule or a `beforeSend` filter rather than skipping forever.
5. **Never** auto-fix anything touching payments, payroll, or `fin_*`
   posting logic — those always go to Open failures for a human.
6. **Batch the paperwork:** one branch/PR per triage run, not per issue.
   If the run produced only notes and no fix, put them in the session
   summary instead of pushing a notes-only commit.

## Cron-health cross-check

While in Sentry, check Cron Monitors (if wired — see monitoring doc §2) for
missed check-ins on: `reconcile-pending` (1 min, order),
`expire-orders` (10 min, order), `attendance-auto-close` (15 min,
backoffice). A missed `reconcile-pending` window is a payments problem —
treat as top priority.

## Lessons

_Append dated entries when this skill misses something. Promote stable ones
into the sections above._
