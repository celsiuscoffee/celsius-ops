# Verifier Agent — closing the loop between alerts and reality

## Problem Statement
Ops-pulse fires WhatsApp alerts correctly, but nothing checks whether they *work*. The
ledger's `RESOLVED` status is a claim (someone replied "DONE", which bulk-closes ALL their
open alerts) verified against nothing; if nobody replies, alerts stay OPEN forever even when
the task actually got done. The system's only response to an ignored nudge is sending the
identical message to the same person the next day — an infinite loop at RM0.07/send with no
exit and no learning.

## Demand Evidence
From the send log (`WhatsAppMessage`) and ledger, last 10 days — all verified by SQL, not vibes:

- "1 overdue checklist with no owner on shift" fired **5 consecutive days**, 36 sends. Nobody claimed it.
- "Full stock count due today @ Putrajaya" fired 3 days / 19 sends; the count still wasn't done.
- Personal nudges ignored for days: Firdaus (4 days), Aina (4 days), Nur (3 days) — same person, same checklist, daily.
- 12 distinct alert bodies fired ≥3 days running.
- Two send-side runaways (menu-86 nudge spam, store-status churn: 147 sends in one day) ran for
  days and were caught **by accident** — one by staff annoyance, one by an ad-hoc cost query.
  (#750/#752 patched those two specifically; nothing watches for the next one systemically.)

## Status Quo (what users do now)
Nothing owns this. Failures surface via staff complaining in WhatsApp (catches spam only,
costs credibility) or Ammar stumbling on anomalies during unrelated QA. Resolution metrics
don't exist because RESOLVED is unverified. Cost: ~RM3–4.50/day in sends, a meaningful slice
of which is provably dead repeats; unowned checklists sitting 5 days = audit/food-safety risk.

## Target User (named person, role, consequence)
**Ammar (founder/ops)** — week-1 recipient of escalation proposals. He already receives the
"no owner on shift" alerts; today they give him no way to distinguish "handled" from "ignored 5
days running". Consequence of status quo: pays for nudges that change nothing, finds out about
dead loops by accident. Second-ring users: the two ops numbers already on the no-owner
distribution (60163230590, 60176579149) — confirm identity/role before widening.

## Narrowest Wedge
**Escalate-on-repeat, in ASSIST mode.** When the same goal fails N days running (N=3), the
verifier STOPS re-nudging the same person and proposes ONE escalation ("Aina has ignored her
checklist nudge 4 days running — escalate to outlet manager?"). Ammar approves/rejects with
one tap (ASSIST principle: agent does all the work, human only decides). Repeat detection is
nearly free: a repeat fire *is* a failed verification — ops-pulse re-checks conditions daily,
so firing again proves yesterday's nudge failed.

## Premises (explicit assumptions)
1. **Repeat fire = unresolved goal** — holds for condition-based signals (CHECKLIST,
   STOCK_COUNT, REVIEW, no-owner). Does NOT hold for per-shift signals (NO_CLOCK_IN is a new
   instance daily) — goal declarations must be per-signal, not generic.
2. **Ground truth is queryable in the same DB** for every signal we verify: checklist
   completion rows, timesheets, stock-count records, review responses.
3. **"DONE" replies are claims, not facts** — `resolveOpenAlertsForUser` bulk-closes
   everything; the verifier treats data as truth and replies as hints.
4. **An escalation target who acts exists** — UNPROVEN. This is the load-bearing premise of
   the whole action layer, and it is being tested manually before code (see Assignment).

## Approaches Considered
### Approach A — escalate-on-repeat rule (days)
Hardcoded rule in ops-pulse: N repeat fires → escalate, stop re-nudging. Cheapest; but it's
one more bespoke per-signal rule — the exact pattern that produced the dedupe-spam bug class.

### Approach B — weekly effectiveness scorecard (~1 week)
Agent computes per-alert verified resolution rates, WhatsApps a weekly digest (which alerts
work, which are noise). Measurement without action; nobody's fired for ignoring a dashboard.

### Approach C — full verifier agent (weeks–months)
Every automation declares a goal + ground-truth check; agent tracks outcomes, verifies
resolutions, pauses ineffective alerts, adapts recipients/wording. Kills the bespoke-logic bug
class, fits the ASSIST architecture — but grants an agent autonomous action over
infrastructure before any trust is earned, and builds an action layer on the unproven premise
that escalations get acted on.

## Recommended Approach
**C-via-A ladder** (chosen 2026-07-05). C is the architecture, A is its first shipped
behavior:
- Day 1: verifier agent exists; each signal type declares `goal` + `verifyGoal()`
  (ground-truth query). Verifier runs daily after the pulse.
- Week-1 behaviors, ASSIST only: (a) auto-resolve alerts whose condition verifiably cleared
  (makes RESOLVED mean something, retroactively fixes metrics); (b) propose-escalation on N≥3
  repeat failures; (c) flag "DONE"-claimed-but-data-says-incomplete.
- Adaptive layer (pause alert types, change recipients, reword) stays LOCKED until a human
  demonstrably acts on ≥1 escalation. Same OFF→ASSIST→AUTO trust ladder as the procurement
  agent, per alert-signal.

## Open Questions
- Who is the per-outlet escalation target above Nur/Aina/Firdaus? (Names + numbers.)
- Do "DONE" replies map to specific alerts, or stay bulk? (Bulk-close undermines per-alert metrics.)
- NO_CLOCK_IN goal semantics: verify against timesheet within X minutes of shift start?
- Where do ASSIST proposals surface — WhatsApp to Ammar, or the Ops Workspace approval queue (or both)?

## Success Criteria (measurable)
- **Week 1:** ≥1 escalation proposal approved AND the underlying condition clears within 48h.
- **Week 2:** 100% of CHECKLIST / STOCK_COUNT / no-owner alerts carry verified (data-checked)
  resolution status; unverified "DONE" closures visible as a separate count.
- **Week 4:** distinct alerts firing ≥3 consecutive days drops from baseline 12 → ≤6; repeat
  sends to the same person for the same goal drop to ~0 (replaced by one escalation).
- **Guard:** daily template spend stays ≤ RM5 (verifier must reduce sends, not add net spam).

## The Assignment (one concrete next step)
Before any code: **test the load-bearing premise by hand.** Next time the "overdue checklist
with no owner on shift" alert fires (it has fired 5 days straight — it will fire tomorrow),
manually WhatsApp the outlet manager exactly the escalation the agent would send: "*This
checklist has had no owner for 5 days at [outlet]. Can you assign someone today?*" If the
condition clears within 48h, the action layer has its proof. If it's ignored the same way the
nudges were, we've learned the fix isn't a verifier agent — it's an accountability
conversation, and no amount of architecture substitutes for it.
