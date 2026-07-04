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
   check required. VERIFIED 2026-07-04 — see results below: all 24 active
   part-timers have rates; all 31 FT/contract have NULL `hourly_rate` but a
   `basic_salary`, so the FT rate is derivable (salary / 26 / 7.5, the
   formula already in `apps/staff/src/lib/hr/constants.ts`).
2. **The projected % is credible** — reconstructing June-2026 from live data
   must land within ~1pt of the workbook's 22.8 / 24.3 / 30.6. If it can't,
   the AM learns to distrust the number and overrides become routine.
   PARTIALLY VERIFIED — revenue side exact, FT labour exact, PT labour has
   a data gap (details below).
3. **All scheduling flows through the app.** If the AM can WhatsApp someone
   onto a shift and pay them via OT/claims, the gate binds nothing. The
   Monday variance report is the detector for this leak, but the owner has
   to enforce "not in the system = not paid". PARTIALLY FAILED as of today:
   61 June shifts were assigned to users with no HR profile, and PT wages
   have been paid outside `hr_payroll_runs` since April.
4. **The owner will hold the red line.** A gate whose override is free is a
   nudge. Override requires the owner's action and shows up on the weekly
   scoreboard with the typed reason.

## Verification Results (2026-07-04, run against production Supabase)

**Revenue: RECONCILED EXACTLY.** June revenue per outlet = `storehub_sales`
(to the ~Jun-15/16/17 per-outlet retirement) + `pos_orders` (in-house POS,
live from Jun-8/15/18, includes GrabFood) + `orders` (pickup app):
Conezion 128,517 vs workbook 128,376 (+0.1%); Shah Alam 106,343 vs 106,344;
Tamarind 80,962 vs 80,961. May validates too (StoreHub alone: 138,295 /
116,125 exact / 82,797 exact). The cutover overlap is complementary
channels, not double-counting. The gate's forecast denominator must UNION
all three sources (from July onward: `pos_orders` + `orders`).

**FT labour: RECONCILED.** June `hr_payroll_items` (gross + employer
statutory) joined through `User.outletId`: Conezion RM18,567 (10 staff),
Shah Alam RM11,992 (5), Tamarind RM14,244 (6). Spot checks against the
workbook: Head of Dept 11,877 vs 11,876; Syafiq 3,988 vs 4,022 (⅓ =
1,341 ✓); Area Manager 4,444 vs the RM4,500 cap.

**PT labour: DATA GAP — this is the repair the build waits on.** Part-timer
items appear in the Jan–Mar payroll runs (RM9–10k/mo) and then vanish:
zero PT items in Apr/May/Jun. Scheduled-hours × `hourly_rate` for June
gives Conezion 4,402 / Shah Alam 10,606 / Tamarind 3,029, which brings the
reconstruction to within ~RM2–6k per outlet of the workbook's implied
labour (24.3k vs 29.3k / 23.9k vs 25.8k / 18.6k vs 24.8k). The residue is
(a) 61 June shifts held by users with no `hr_employee_profiles` row (~570
scheduled hours, uncostable), (b) one FT with no outlet (Shella, RM2,507),
and (c) whatever PT top-ups are paid off-system. All six 2026 monthly
payroll runs are still status `draft`.

**Half-built infra worth reusing:** `hr_schedules` already has
`total_labor_hours` and `estimated_labor_cost` columns, but only 7 of 35
published schedules have a cost — the field is written sometimes (AI
generation path) and gated on never. The gate should make this column
mandatory-and-trusted rather than invent a new one.

**Data repairs before the gate ships (in order):**
1. Route PT wages back through payroll runs (or a PT wage ledger the gate
   can read) — Apr–Jun PT cost is invisible to the system today.
2. Create HR profiles (with rates) for every scheduled user; add a
   publish-time check refusing shifts for profile-less or rate-less users.
3. Backfill `User.outletId` for the one unassigned FT; formalise the
   rovers/HQ list (HoD, Area Manager, Syafiq, Director×2) so outlet
   attribution is total.
4. Derive FT `hourly_rate` at read time from `basic_salary`/26/7.5 instead
   of waiting on a column backfill.

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
- ~~How many active employees have NULL `hourly_rate` today?~~ Answered:
  31 of 55 actives (all FT/contract) — derivable from `basic_salary`.
- Where are Apr–Jun part-timer wages actually being computed and paid?
  (BrioHR leftover? manual sheets?) The gate needs that flow inside the
  system.
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
~~Reconstruct June-2026 labour % per outlet from live data.~~ DONE
2026-07-04 (see Verification Results). The revenue denominator and FT cost
are gate-ready today; the build now waits on one thing: **bring part-timer
wages back inside the system** (repair #1 above) and profile the 61
orphan-scheduled users (repair #2). Once PT cost is queryable, the gate's
number matches payroll and the publish gate ships as designed.
