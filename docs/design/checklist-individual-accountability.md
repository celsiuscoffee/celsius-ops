# Checklist — Individual Accountability by Shift

Office-hours 2026-06-29. Owner wants to move checklist accountability from
team-based to **individual**, divided by the arranged shift, and asked how to make
it (1) fair, (2) survive a no-show, (3) objectively "not done".

## Problem Statement
Checklists are team-routed today, so **nobody owns them** (owner's words; confirmed
in data: 261/293 checklists in the last 7d have `assignedToId = null`). Diffusion of
responsibility → the closing list just doesn't get done and there's no one to ask why.

## Demand Evidence
Checklists are actively used (293 created in 7d across 4 outlets), and **41 are
overdue right now**. The pain is real and recurring; the status quo (team list, no
owner) demonstrably leaves tasks undone. This is not a new feature looking for a
user — it's an existing, used feature with a broken accountability model.

## Status Quo (what staff do now)
A checklist is generated per shift with a `dueAt`; anyone on shift can tick items;
most are left `assignedToId = null`. When a task is missed, no individual is on the
hook — it's "the team's" miss. Owner's diagnosis: **"nobody owns it."**

## Target User (named)
**The shift lead / supervisor** (e.g. Yusri @ Putrajaya, Aina @ Tamarind) — the
person who today gets blamed when the close isn't done but has no system telling them
who was supposed to do what. Win: each task has a present, named owner; the lead only
chases the actual gap, not the whole list.

## Floor reality (observed)
Owner confirms **work flows by station** — the bar person cleans the bar, kitchen
person closes the kitchen. So tasks have a natural role/station owner; a role-based
model fits reality (not "the lead does everything", not "ad hoc grab").

## Premises (explicit assumptions)
- P1. The roster (`hr_schedule_shifts.role_type`) puts a named person in a role for
  each outlet+date. TRUE — 413/413 shifts have role_type. ⚠ but the taxonomy is
  MIXED: stations (Barista, Kitchen Crew, Supervisor, Barista Lead, Kitchen Lead) +
  shift-segments (Opening, Closing, Middle 1, Middle 2). A clean task→role map needs
  a decision on which axis a task keys off.
- P2. The schema already supports individual ownership + objective completion:
  `Checklist.assignedToId`, `completedById`, `completedAt` (28/28 completions carry a
  completer). So this is "populate + resolve", not "build assignment".
- P3. The failure is OWNERSHIP, not honesty. Owner did NOT pick "ticked but not real."
  So completion = status `COMPLETED` + timestamp is trusted; photo/temp verification
  is OUT OF SCOPE until gaming is shown to be a real problem.
- P4. Roster = the plan; clock-in (`hr_attendance_logs`) = the truth. Ownership at
  due-time follows clock-in, not the roster.

## The three questions, answered

**1. Fair for all.** Fairness comes from the ROSTER, not a task-distribution
algorithm. Tasks belong to a role; the manager already balances who works which role.
The system's job is to (a) attribute role-tasks to the rostered+present person and
(b) make per-person completion rate VISIBLE so a coaster or an over-loaded role shows
up in data the manager rebalances against. The system never auto-distributes — it
mirrors the roster and surfaces imbalance. Heavy-role-always-on-one-person is a
rostering fix, made with the data the loop produces.

**2. If the assigned person doesn't clock in.** Resolve the ACTUAL owner at due-time:
- Planned (rostered) owner clocked in → they own it; remind them.
- Planned owner NOT clocked in, but someone else clocked in for that role → that
  person owns it (they're covering).
- No one in that role clocked in → the **shift lead** owns "get it covered / reassign."
- The no-show itself is a SEPARATE signal (the clock-in nudge already fires). Do NOT
  blame an absent person for a task they weren't present for — that's the unfairness
  trap. The task re-homes to whoever is actually there.

**3. Objectively "not done".** `dueAt + grace` passes and `status != COMPLETED` → not
done. Objective: a status + timestamp, no judgement. The miss is attributed to the
clocked-in role owner at due-time (or the shift lead if the role was unmanned).
Gaming (ticking done falsely) is a different failure (verification) and explicitly
deferred per P3.

## Approaches Considered

### Approach A — opening/closing owner (wedge, ~days)
At the checklist nudge, resolve owner from the EXISTING `shift` field: OPENING list →
the rostered+clocked-in "Opening" person, CLOSING → "Closing" person; fall back to the
shift lead if unmanned. DM the individual; escalate to the lead if still not done at
`dueAt + grace`. Uses only existing data (shift, roster role_type, clock-in,
assignedToId, completedById). Coarse (one owner per opening/closing list, not
per-station) but kills "nobody owns it" immediately. No new content setup.

### Approach B — station-level owner (medium, ~weeks)
Tag each SOP/checklist with a STATION (bar / kitchen / floor). Resolve owner =
clocked-in person in that station's role. Matches the "by station" reality precisely.
Populate `assignedToId` at roster-publish so owners are visible up front. Add a
per-person completion-rate view for managers (the fairness/coasting lever) and
re-resolve on early clock-out. Requires SOP→station tagging (content work) + roster
role normalisation.

### Approach C — full accountability platform (months)
+ photo/temp verification for high-stakes items, + auto-balancing roster suggestions,
+ a per-person accountability scoreboard with appeals/override. Scope-creep; do not
build before A proves the loop and gaming is shown to be real.

## Recommended Approach
**Ship A now, target B.** A establishes a present, named owner per list using only
data that already exists — it kills the actual failure ("nobody owns it") in days,
with zero content setup. Because the floor genuinely works by-station, B is the right
end-state, but its prerequisite is **tagging SOPs with stations**, which is a manager
content task, not engineering — start that in parallel.
Evidence that flips A→B sooner: if "the Closing person owns the whole closing list"
just recreates a mini nobody-owns-the-bar-task within the list (i.e. opening/closing
is too coarse to be fair), jump to station tagging immediately.

## Open Questions
- Task→role axis: do checklist tasks key off shift-segment (Opening/Closing) or
  station (Barista/Kitchen)? A says segment (free, coarse); reality says station.
- Grace + escalation timing: how long after `dueAt` before the owner is pinged, and
  before it escalates to the lead?
- Where does the per-person completion-rate live — the scorecard, or a new view?

## Success Criteria (measurable)
- `assignedToId` populated on >90% of checklists (vs 11% today).
- Closing-checklist completion rate by `dueAt` rises (baseline this week first).
- Each overdue checklist resolves to exactly one present owner (or the lead), never to
  an absent person.

## The Assignment (one concrete next step)
Before any code: sit through ONE full closing shift at Putrajaya or Tamarind and write
down, per checklist item, **who physically did it and what role they were rostered as**.
That answers the one open question that decides A vs B — whether "the closing person"
is a fair owner for the whole list, or whether tasks must be owned per station. Don't
guide; just watch and record role-vs-task.
