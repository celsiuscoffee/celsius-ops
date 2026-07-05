# Verifier Agent — closing the loop between alerts and reality

*Revised 2026-07-05 after root-cause dig. The original draft proposed "escalate-on-repeat";
Ammar's correction ("checklists are auto-assigned by the system — escalation to a manager
won't help") sent us back to the data, and the data agreed with him.*

## Problem Statement
The ops-alert layer verifies nothing and diagnoses nothing. When a goal fails, it cannot tell
*where in the chain* it failed — so it nudges humans about defects only code can fix. The
checklist pipeline is the proven case:

1. **61% of checklists are born ownerless and stay that way.** Daily generation (staff-app
   `/api/checklists/generate`, Source 1) creates them with `assignedToId: null` — "anyone can
   claim". Nobody ever claims: **0 of 279 unassigned checklists completed in 10 days (0%)**,
   vs **56.3%** for assigned ones. The claim model is dead on arrival.
2. **The assigner only runs when a human touches the roster.** `linkChecklistsToSchedule`
   fires solely on HR schedule save/publish. Checklists created by the daily cron get an owner
   only if a manager happens to re-save the roster afterwards. Days nobody touches it (
   weekends, today: 33/39 ownerless *despite rosters existing for all 3 outlets*), everything
   stays unowned.
3. **The alert layer then screams into the void.** "Overdue checklist, no owner on shift"
   fired 5 consecutive days / 36 sends at RM0.07 each — to recipients who cannot fix
   ownership, about a condition the system itself created.
4. The ledger's `RESOLVED` is a claim, not a fact — a "DONE" reply bulk-closes ALL the
   sender's open alerts, verified against nothing.

## Demand Evidence (all SQL-verified, 10-day window)
- Unassigned checklists: **279 total, 0 completed (0.0%)**. Assigned: 176, 99 completed (56.3%).
- Completion tracks assignment day-by-day: Jul 1–4 (linker ran, 1–6 unassigned/outlet) → 16–19
  done/day; Jun 27–29 + Jul 5 (linker didn't run, 33–40 unassigned) → 1–6 done/day.
- Named assignees (Aina, Firdaus, Nur) WERE rostered on every nudged day — those are real
  compliance cases, not premise failures; the named-nudge layer half-works (56%).
- Nilai: no roster rows at all → 7 permanently-ownerless checklists/day → daily alert spam.
- Two send-side runaways (menu-86, store-status: 147 sends/day) caught only by accident.
- 12 distinct alert bodies fired ≥3 consecutive days.

## Status Quo (what users do now)
Nothing owns verification. Failures surface via staff annoyance or Ammar stumbling on
anomalies in ad-hoc queries (both runaways, and this ownership hole, were found exactly that
way). Cost: ~RM3–4.50/day of sends, much provably dead; ~24 checklists/day generated into a
state with a known-0% completion rate — unowned food-safety/audit work.

## Target User (named person, role, consequence)
**Ammar (founder/ops).** He receives the void-alerts today and pays for them twice: RM for the
sends, and false confidence that "the system is chasing it" when the chase provably does
nothing. Second ring: outlet staff who get nudged for structurally impossible goals — every
such nudge burns credibility of ALL nudges (the 56% that work included).

## Narrowest Wedge — Sprint 0 (before any agent): pre-assign from the roster
*(Revised again after the implementation dig, 2026-07-05 evening.)* Deeper diagnosis: a fair
JIT assignment engine ALREADY exists (`runChecklistNudges` §5 — station match, lightest-load,
clock-in-verified, persists `assignedToId`; owner decision 2026-06-29 "roster = plan, clock-in
= truth"), and a roster-gap alert already exists (§7 `runRosterPublishNudges`). The broken
leg is neither: it's that the JIT engine only acts once a task is ALREADY overdue and only
recognizes staff who clocked in via the app — and **app clock-in adoption is erratic (0–13 of
~18 rostered/day; rosters ARE published, all 281 unassigned checklists HAVE due times)**.
Completion tracks clock-ins day-for-day: Jul 1–4 (9–13 clock-ins) were exactly the
high-assignment/high-completion days.

Shipped as Sprint 0 (all in `ops-nudges`):
1. **Shift-start pre-assignment (`assignTodaysChecklists` + `/api/cron/checklist-assign`,
   every 30 min through the trading day).** Every still-unowned checklist for today gets a
   fair owner from the PUBLISHED ROSTER — same station/lightest-load rules, clock-in NOT
   required. The plan owns it by default; the app shows ownership all day.
2. **JIT re-owning stands.** At nudge time the existing pass still reassigns to whoever
   actually clocked in ("explicit assignment wins IF on shift") — a pre-assigned absentee is
   never nudged for a shift they didn't work. Plan-ownership and truth-nudging compose.
3. **Unowned digest → once per outlet-day, cause included.** Was per-checklist (36 sends / 5
   days for one condition); now one line per outlet per day: "*N overdue checklists with no
   owner on shift — 18 rostered, 0 clocked in via the app*" — pointing at the adoption
   problem, not phantom absence.

Expected effect: unassigned rate 61% → ~0 (roster gaps only); the dead pool moves toward the
56% band; unowned-digest spam collapses to ≤1/outlet/day. NOT fixed by code: clock-in
adoption itself — surfaced explicitly by the new digest line.

## Premises (explicit assumptions)
1. **Assignment causes completion** (not just correlates). Strong evidence: the 0%-vs-56%
   split and the day-by-day tracking. Sprint 0 is also the experiment that proves causation —
   if completion doesn't move once everything is assigned, adoption is the real problem.
2. **Repeat fire = unresolved goal** — holds for condition-based signals; NOT for per-shift
   ones (clock-in is a new instance daily). Goal declarations must be per-signal.
3. **"DONE" replies are claims** — verifier treats data as truth, replies as hints.
4. ~~"An escalation target who acts exists"~~ — **KILLED 2026-07-05.** Assignment is systemic;
   there is no human whose scolding fixes a linker that doesn't run. Escalation returns later
   only for verified *compliance* failures (rostered, on-shift, nudged, still not done).

## Approaches Considered
### Approach A — escalate-on-repeat rule (days) — REJECTED as first move
Would have escalated 279 system-defect alerts to managers who can't act on them. The
diagnostic that killed it is the strongest argument FOR premise-verification.
### Approach B — weekly effectiveness scorecard (~1 week)
Measurement without action; folds into the verifier's metrics for free after Sprint 0.
### Approach C — full verifier agent (weeks–months)
Goal declarations + outcome tracking + adaptive actions. Right destination, wrong first step —
adaptive authority must be earned on the same OFF→ASSIST→AUTO ladder as the procurement agent.

## Recommended Approach — Sprint 0, then C-via-A
- **Sprint 0 (now, no agent):** assign-at-birth + daily linker sweep + re-aimed roster-gap
  alert. This is a bug fix the verifier would have demanded anyway.
- **Verifier v1 (ASSIST only), aimed by the chain model.** Every goal declares its chain:
  *created → owned → owner rostered/on-shift → nudged → verifiably done*. The verifier's
  daily pass reports the FIRST broken link, not the last symptom:
  - premise checks: ownerless work, assignee not rostered, roster missing → propose a system
    fix to Ammar, never a staff nudge;
  - verified auto-resolve: close alerts whose condition actually cleared (makes RESOLVED real);
  - claim audit: "DONE" replied but data says incomplete → flag;
  - compliance repeat (rostered + nudged + still pending ≥3 days) → NOW propose escalation,
    because the premise is verified and only then does a human conversation help.
- **Adaptive layer stays locked** until a human acts on ≥1 verifier proposal.

## Open Questions
- Who owns rosters per outlet (the roster-gap alert recipient)? Nilai has none at all — who
  should?
- Shift-window → checklist matching rule when multiple staff overlap (senior-most? explicit
  role tags?).
- Do "DONE" replies stay bulk-close, or map to specific alerts?
- Where do verifier proposals surface — WhatsApp to Ammar, Ops Workspace queue, or both?

## Success Criteria (measurable)
- **Sprint 0, week 1:** unassigned-at-due-time rate < 10% (roster gaps only); "no owner"
  sends ≤ 1/outlet/day (baseline: 36 sends / 5 days for one alert).
- **Sprint 0, week 2:** overall checklist completion ≥ 45% (baseline 21.8% = 99/455), i.e.
  the former dead pool performs near the assigned band. If it doesn't move → adoption problem,
  revisit before building the agent.
- **Verifier v1, week 4:** 100% of CHECKLIST/STOCK_COUNT alerts carry verified resolution;
  alerts firing ≥3 consecutive days drop 12 → ≤6; daily template spend ≤ RM5.

## The Assignment (one concrete next step)
~~Manually escalate to the outlet manager~~ — killed; there's nothing a manager can do about a
linker that doesn't run. The new assignment is a build task plus one human question:
1. **Ship Sprint 0** (assign-at-birth + daily sweep + roster-gap alert) and watch one number:
   checklist completion rate, 7 days before vs 7 days after. That single delta decides whether
   the verifier agent gets built on proof or on hope.
2. **One human question for Ammar:** who owns the Nilai roster? It has zero shifts entered —
   no code fixes an outlet nobody rosters.
