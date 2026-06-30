# Ops Realtime Consequence Loop (Tiers 3 & 4)

Office-hours diagnostic, 2026-07-01. Designs the two open tiers from the Ops
Workspace audit: tier 3 (alert lifecycle) and tier 4 (behavioral effectiveness).

## Problem Statement
The ops nudges fire reliably (clock-in 54/wk, checklist 28, stock 41) but the
lead measures haven't moved: clock-in flat ~4/day, checklist ~15% done,
stock-count 0 counts despite 41 nudges. The instinct was to build more
mechanics: tier 3 = escalate unacked alerts to the owner; resolve them on a
"DONE" reply. The diagnostic killed that instinct.

## Demand Evidence
Behaviour, not opinion: the nudges already arrive and are ignored. So the
bottleneck is provably NOT notification. Adding owner-escalation or a resolve
handshake is more notification machinery on a problem that notification doesn't
solve. There is no evidence a louder ping changes a flat number.

## Status Quo (what users do now)
The consequence ALREADY exists and is automatic: the HR performance allowance
(RM200 pool, 4 KPI levers with deductions) is wired to clock-in / checklist /
stock. A miss costs the staff member real money. BUT they only meet that cost on
the monthly payslip — one abstract lump, weeks after the Tuesday they slept in.
There is no felt cause-and-effect at the moment of the miss.

## Target User (named person, role, consequence)
The floor staff member who skips clock-in — e.g. a Putrajaya closing-crew barista
rostered 15:30-23:30 who never clocks in. What changes their behaviour is not
their manager's awareness and not the owner's escalation: it's feeling the RM cost
in the moment, while they can still act on it. Today the cost is invisible until
payday, so to them clocking in is pure hassle with no visible upside.

## Narrowest Wedge
Enrich the EXISTING clock-in nudge (keystone signal — checklist ownership depends
on clock-in) with the staff member's live allowance balance:

> "You haven't clocked in for your 15:30 shift. Each miss is -RM10 from your
>  RM200 this month — you're at RM180. Clock in now to keep it."

No new tables, no app screens. Just the number the payroll engine already
computes, surfaced into the message they already receive, at the moment they can
still act. Measure: does clock-in rate move at the test outlet in 2 weeks.

## Premises (explicit assumptions — these gate the build)
1. **The per-miss deduction is material.** If one missed clock-in costs RM2,
   nobody changes behaviour for RM2 and the whole loop is dead on arrival. If it's
   RM15-20, it has teeth. UNVERIFIED — get this number first.
2. **The allowance balance is computable in real time**, not only at the month-end
   payroll run. If it's only a payroll-time calc, A grows from days to weeks (need
   a live balance function). UNVERIFIED.
3. **Staff read the WhatsApp nudges.** They receive them; open-rate unknown. Low
   staff-app engagement is the working theory for why clock-in is low — which is
   exactly why the cost rides WhatsApp, not an app screen.
4. **The RM200 is material vs base pay** (≈13% on a ~RM1500 base) — assumed yes.

## Reframing tiers 3 & 4
- **Tier 4 (behaviour) = collapse the time between the miss and the felt cost.**
  Put the live allowance number in the nudge + a running meter in the staff app.
  This is the 4DX "compelling scoreboard" at the individual level: "am I winning?"
  becomes "how much of my RM200 is still intact?"
- **Tier 3 (lifecycle) = demote owner-escalation; promote visible resolution.**
  The consequence is already automatic (payroll), so it does NOT need the owner to
  chase — auto-escalation was solving a problem that doesn't exist. Instead:
  - *Resolve* = the staff member acts (clocks in / does the checklist). The alert
    closes AND the balance ticks back up — the win is made visible. This is the
    only lifecycle mechanic worth wiring.
  - *Escalation* = a WEEKLY per-person digest to the manager (who's bleeding
    allowance), feeding the weekly accountability review — NOT a 90-min auto-page
    to the owner. The human cadence, not a faster robot.

## Approaches Considered

### Approach A — Cost-in-the-nudge (days)
Compute each staff member's current-month allowance balance + per-miss cost from
the existing HR allowance data; append it to the clock-in nudge. Clock-in only.
All outlets (it's a message change, low risk). Nothing else built.
Effort: 2-3 days (gated on premise 2 — the balance being real-time computable).

### Approach B — Felt loop (weeks)
A, plus:
- Staff-app live allowance meter (running balance + per-miss breakdown), updated
  when a miss or recovery is recorded.
- Extend the cost line to the checklist + stock nudges.
- Weekly per-person WhatsApp summary ("your allowance this week: RM180, -RM20 to 2
  late clock-ins") — the felt cadence that also feeds the manager's weekly review.
- Resolution wired: acting closes the alert + bumps the balance visibly.
Effort: ~2 weeks.

### Approach C — Full individual 4DX scoreboard (months)
Real-time personal scoreboard across every lead measure (clock-in, checklist,
stock, capture, upsell) with RM impact, live in app + WhatsApp; manager
weekly-review dashboard; owner league table; full lifecycle (resolve-on-action +
manager weekly digest replacing owner auto-escalation).
Effort: 1-2 months.

## Recommended Approach
**A first, then B.** The entire system rests on one unproven bet: *if staff feel
the RM cost in real time, behaviour moves.* Approach A tests that bet for the price
of enriching one message. If clock-in rate at the test outlet climbs in 2 weeks,
the bet is validated and B is justified. If it doesn't move, the problem is deeper
(deduction too small, or staff don't believe it's real) and no app-building would
have helped — A saves weeks of wasted scope.

**What flips this:** if premise 2 fails (balance only computable at payroll run),
A already needs a real-time balance function — at which point fold that into a
slightly larger first step. And if premise 1 fails (deduction immaterial), STOP —
the lever is the deduction size, not the loop.

## Open Questions
- What does ONE missed clock-in actually cost in RM? (premise 1 — gates everything)
- Is the allowance balance queryable live, or only at payroll run? (premise 2)
- Are checklist + stock among the 4 KPI levers, or only attendance?
- Does a "recovery" (clock in late) restore part of the deduction, or is the miss
  permanent? (decides whether the nudge can credibly say "clock in now to keep it")

## Success Criteria (measurable)
- Clock-in rate at the test outlet rises from ~baseline (~20-25%) toward 60% within
  2 weeks of A shipping. (Lead-measure movement, not send counts.)
- The nudge shows a correct live balance (spot-checked vs the payroll calc).
- If A works: checklist completion + stock-count cadence move under B.

## The Assignment (one concrete next step)
Before writing any loop code: **pull the actual allowance-deduction rules and put a
real number on one missed clock-in.** Is it RM2 or RM20, and can you compute a
staff member's balance from live data today (not just at the payroll run)? Those
two numbers decide whether this is a 3-day win or a dead end — and no amount of
loop-building substitutes for knowing them.
