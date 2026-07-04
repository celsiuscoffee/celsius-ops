# People-Cost Gating Loop (target 18%, ceiling 20%)

Loop-engineering diagnostic, 2026-07-04. Companion to the Manpower Plan by
Outlet workbook (May basis). Designs the control loop that holds outlet labour
% at the 18% target / 20% ceiling — and specifically stops the Area Manager
and Head of Ops from over-scheduling.

## Problem Statement
People cost is bloated: June-2026 labour % ran Conezion 22.8%, Shah Alam
24.3%, Tamarind 30.6% against an 18% target. The manpower workbook already
computed the right-sized roster (RM98,879 → RM80,839/mo, saving
RM18,040/mo ≈ RM216k/yr). The plan exists; nothing enforces it. The two
people who build rosters — the Area Manager and Head of Ops — keep
publishing more shifts than the plan, and nobody feels the cost until the
month-end payroll lands weeks later.

## Demand Evidence
Behaviour, not opinion: 9 months of monthly labour % (workbook "All Months")
show only 3 outlet-months at or under 18% since Oct-2025, and the trend is
worsening (May/Jun-2026: 5 of 6 outlet-months over the 20% ceiling). The
right-sized shift plan has existed since the May analysis and rosters did not
shrink. So the bottleneck is provably NOT knowing the answer — it is that
publishing an over-budget roster costs the publisher nothing at the moment
they do it.

## Status Quo (what users do now)
Rosters are built in the staff app (`hr_schedules` + `hr_schedule_shifts`,
draft → published state machine, `apps/staff/src/app/api/schedules`). The
editor shows shifts and people — it never shows money. The consequence
already exists and is automatic (payroll actuals vs revenue), but it arrives
as one abstract month-end number, weeks after each generous Tuesday roster.
Same shape as the clock-in problem in
`ops-realtime-consequence-loop.md`: the cost is real but not felt at the
moment of the action. One difference matters: there the actor was floor
staff reachable only by WhatsApp nudge; here the actors are two managers
acting **inside our app at a single choke point (publish)** — so we can gate,
not just nudge.

## Target User (named person, role, consequence)
The Area Manager building next week's Shah Alam roster on Thursday. Today he
adds a 5th closing pax "to be safe", publishes, and nothing happens to him.
Under the loop, the editor shows "this roster = 21.4% of forecast revenue —
RM1,900 over budget" while he is still dragging shifts, and publish refuses
to proceed past the ceiling without an owner override. Same for the Head of
Ops, and for the Area Manager rostering **himself** beyond the 2-days/outlet
rover quota (his OT is why HQ trims RM1,261/mo).

## The Loop (sense → gate → act → measure → correct)
1. **Sense — budget per outlet-week.** Forecast revenue/day = trailing
   4-week same-weekday average from `pos_orders` (the ops-pulse detectors
   already query this per outlet/day). Budget = 18% of forecast.
2. **Sense — cost of the draft roster.** Shift cost = hours ×
   `hourly_rate` × (1 + employer statutory) per assigned employee, + 1/3
   Syafiq allocation per outlet (RM1,341); Area Manager hours are credited
   at RM0 to the outlet (HQ overhead, per the rover model) but count against
   his 2-days/outlet quota.
3. **Gate — at publish**, per outlet-week:
   - ≤ 18% of forecast: publish normally (green).
   - 18–20%: publish requires a typed reason, logged (amber).
   - > 20%: publish blocked; owner override only, logged (red).
   - Independent of %: rover-quota breach (AM > 2 shifts/wk at an outlet or
     > 6 total) and OT-bearing shifts for salaried managers are amber-gated.
4. **Act.** The editor pre-fills the workbook's shift-plan template as the
   default roster (Conezion 3+4 / 4+4 / 4+4 wkday/Fri/wknd; Shah Alam 3+3 /
   3+4 / 4+4 + the 10:00–18:00 mid shift; Tamarind 3+3 service floor), so
   the compliant roster is the path of least resistance.
5. **Measure.** Every Monday, actuals: attendance hours × rates /
   `pos_orders` revenue per outlet, last week — plus variance vs what the
   published roster promised (plan said 18%, actuals 21% ⇒ OT or
   post-publish shift adds; migration 070's delete audit already exists, an
   insert-after-publish audit closes the other half). Posted to the weekly
   review scoreboard, WoW trend per outlet.
6. **Correct.** Weekly: variance feeds next week's roster. Monthly: re-fit
   the shift floors from updated hourly sales (the workbook's RM69
   sales-per-labour-hour method), so the template tracks demand instead of
   fossilising May.

## Per-outlet budgets, not a blanket 18%
Tamarind at the 3-pax service floor runs ~25% on RM2,363 weekdays — the
workbook itself says the fix is weekday revenue, not fewer staff. A blanket
18% gate there fires every week, trains everyone that red is normal, and
kills the loop's credibility. Budgets ship as: Conezion 16% target / 18%
ceiling, Shah Alam 18% / 20%, Tamarind 22% interim / 25% ceiling with an
explicit revenue-growth review date. The company still lands ≤ 18% blended
because Conezion over-delivers.

## Premises (explicit assumptions — these gate the build)
1. **Every rosterable employee has a costable rate.** `hourly_rate` is
   nullable in `apps/staff/src/lib/hr/types.ts`; a NULL rate silently
   under-counts the roster and the gate lies. Backfill + NOT-NULL-at-publish
   check required. UNVERIFIED.
2. **The projected % is credible** — reconstructing June-2026 from
   attendance × rates / `pos_orders` must land within ~1pt of the workbook's
   22.8 / 24.3 / 30.6. If it can't, the AM learns to distrust the number and
   overrides become routine. UNVERIFIED — this is the assignment below.
3. **All scheduling flows through the app.** If the AM can WhatsApp someone
   onto a shift and pay them via OT/claims, the gate binds nothing. The
   Monday variance report is the detector for this leak, but the owner has
   to enforce "not in the system = not paid".
4. **The owner will hold the red line.** A gate whose override is free is a
   nudge. Override requires the owner's action and shows up on the weekly
   scoreboard with the typed reason.

## Approaches Considered

### Approach A — Cost-in-the-editor (days)
Read-only: projected labour % + RM-over/under badge in the schedule editor
and on the publish confirmation, per outlet-week; Monday actuals-vs-plan
WhatsApp digest to owner + both managers through the existing ops-pulse
sender. No blocking. Tests the bet cheaply: does making the cost visible at
the moment of rostering move the published roster toward plan?

### Approach B — The gate (≈2 weeks)
A, plus enforcement: publish API refuses > ceiling without owner override,
amber requires a logged reason, rover-quota + manager-OT checks,
insert-after-publish audit, per-outlet budget table (editable by owner
only), weekly scoreboard wired into the weekly review.

### Approach C — Closed-loop rostering (1–2 months)
Auto-generate the draft roster from the demand forecast + shift template
(the workbook's mid-shift method as code), manager just adjusts; tie a slice
of the AM/HoO performance allowance to hitting the outlet labour % (the
consequence-loop pattern applied one level up); monthly auto-refit of
floors.

## Recommended Approach
**A + B's publish gate together, then the rest of B.** Normally the house
rule is "test visibility before building mechanics" — but the
consequence-loop doc already established that visibility alone doesn't move
behaviour when ignoring it is free, and here the hard gate is cheap: one
check in the publish route once the % is computable (which A builds anyway).
The expensive unproven tier is C — don't touch it until two months of gate
data show where rosters still leak. What flips this: if premise 2 fails
(can't reproduce June within ~1pt), stop and fix the data before any UI —
a gate on a wrong number is worse than no gate.

## Open Questions
- How many active employees have NULL `hourly_rate` today? (premise 1)
- Does "Head of Ops" roster through the same publish endpoint, or via a
  side path the gate must also cover?
- Post-publish shift **adds**: gate them at insert (strict) or only count
  them in Monday variance (loose)? Start loose, tighten if it leaks.
- Public holidays / Ramadan / promo days: manual forecast override per day,
  owner-approved, or the trailing average will misprice them both ways.

## Success Criteria (measurable)
- Published-roster projected % ≤ per-outlet ceiling for ≥ 90% of
  outlet-weeks within 4 weeks of the gate shipping.
- Actual outlet labour %: Shah Alam ≤ 20% within one full month (the
  RM6.3k/mo prize), Conezion ≤ 18%, Tamarind ≤ 25% with weekday revenue on
  the monthly review agenda.
- Plan-vs-actual variance ≤ 2pts (proves OT/side-scheduling leak is closed).
- Area Manager OT ≈ RM0; his shifts within rover quota (the RM1,261/mo trim
  holds without anyone chasing it).
- Blended 3-outlet labour % ≤ 18% within two full months (June baseline:
  ~25% blended).

## The Assignment (one concrete next step)
Before writing any gate code: **reconstruct June-2026 labour % per outlet
from live data** — attendance hours × `hourly_rate` × (1 + employer
statutory) + Syafiq's third, over `pos_orders` revenue — and reconcile
against the workbook's 22.8 / 24.3 / 30.6. In the same pass, count active
employees with NULL `hourly_rate`. Those two results decide whether this is
a days-scale build or a data-repair project first — and no amount of
gate-building substitutes for a number the Area Manager can't argue with.
