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

**PT labour: FOUND IN THE FINANCE MODULE.** Part-timer items appear in the
Jan–Mar payroll runs (RM9–10k/mo) and then vanish from payroll — because
PT wages are paid as weekly bank transfers and land in the GL instead:
account `6500-03 Part timer staff` via `BankStatementLine` rows classified
by the `partimer` rule (June total RM24,403). Since June the bank
description even carries the outlet and the work week ("Seksyen 13 Shah
AlamENGKU EMRAN… PT Week 23/26"), so June PT per outlet is exact:
Conezion 5,103 / Shah Alam 9,168 / Tamarind 6,078 / Nilai 3,892. The only
defect is a classifier bug: the rule stamps `outletId` for "Conezion
Putrajaya" and "Tamarind Square" prefixes but NOT for "Seksyen 13 Shah
Alam" or "Gastrohub Nilai" — those lines land with NULL outlet, which is
why the GL looked untagged. Pre-June bank lines have no outlet prefix at
all ("TRANSFER FR A/C <NAME>"), so historical attribution needs a
payee-name → employee → `User.outletId` map.

**PT cross-check against the owner's part-timer detail sheet** (Google
Sheets, per-outlet monthly PT wages, 2025–2026): June-2026 sheet figures
are Conezion 5,942 / Shah Alam 9,239 / Tamarind 6,344 / Nilai 3,220 / IOI
Mall 712 (total 25,457). The bank-line parse lands within ~4% of the sheet
(24,403); deltas are week-worked vs payment-date timing plus the "IOI MALL
PUTRAJAYA" prefix missing from the parse. The sheet's May Nilai figure
(4,391) matches the manpower workbook's Nilai line exactly — sheet, GL,
and workbook are one chain. The classifier fix should reconcile monthly
against this sheet until the sheet can be retired.

**Full June reconstruction** (outlet FT gross+employer from payroll + PT
from the detail sheet + ⅓ Syafiq, Area Manager excluded — the workbook's
definition): Conezion 25,850 = 20.1% (workbook 22.8%), Shah Alam 22,572 =
21.2% (24.3%), Tamarind 21,929 = 27.1% (30.6%). Same ranking, same
red/amber verdicts, a consistent ~RM3k/outlet below the workbook. That
residual is now isolated to the FT side: all six 2026 monthly payroll runs
are still `draft` (OT and allowances not finalised), plus one FT with no
outlet (Shella, RM2,507) and the question of whether IOI Mall PT (712)
folds into Conezion (would take it to 20.7%). Finalising the draft runs
should converge the two numbers.

**Half-built infra worth reusing:** `hr_schedules` already has
`total_labor_hours` and `estimated_labor_cost` columns, but only 7 of 35
published schedules have a cost — the field is written sometimes (AI
generation path) and gated on never. The gate should make this column
mandatory-and-trusted rather than invent a new one.

**Data repairs before the gate ships (in order):**
1. Fix the `partimer` bank-classifier rule to stamp `outletId` for the
   "Seksyen 13 Shah Alam", "Gastrohub Nilai", and "IOI Mall Putrajaya"
   prefixes (one-rule fix; the June-onward bank format makes it trivially
   parseable). The Monday actuals then read PT cost per outlet straight
   from the GL, keyed to the "PT Week NN/YY" token for week-worked
   accrual, reconciled monthly against the owner's part-timer detail
   sheet until that sheet is retired.
2. Create HR profiles (with rates) for every scheduled user (61 orphan
   June shifts); add a publish-time check refusing shifts for profile-less
   or rate-less users — the forward-looking gate prices the roster from
   rates × hours, so this is its data contract.
3. Backfill `User.outletId` for the one unassigned FT; formalise the
   rovers/HQ list (HoD, Area Manager, Syafiq, Director×2) so outlet
   attribution is total.
4. Derive FT `hourly_rate` at read time from `basic_salary`/26/7.5 instead
   of waiting on a column backfill.
5. Finalise the six `draft` payroll runs so FT actuals include OT and
   allowances — until then the actuals side reads ~3pts flattering.

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
- ~~Where are Apr–Jun part-timer wages actually paid?~~ Answered: weekly
  bank transfers → `BankStatementLine` (`partimer` rule) → GL `6500-03`.
  Remaining sub-question: who computes the weekly PT amounts upstream of
  the bank transfer, and can that computation read the same scheduled
  hours the gate prices?
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

## Implementation (2026-07-05)

Shipped on this branch:
- **Classifier fix** (`bank-line-classifier.ts`): "Seksyen 13 Shah Alam",
  "Gastrohub Nilai", and "IOI Mall Putrajaya" prefixes now infer the outlet;
  migration 071 backfilled 266 already-ingested PARTIMER lines (179 SA /
  63 Nilai / 24 IOI). June PT per outlet from tagged bank lines now
  reconciles with zero untagged lines.
- **Labour gate** (`lib/hr/labour-gate-lib.ts` pure + `labour-gate.ts` IO):
  per-outlet budgets (CC001 16/18, CC002 18/20, CC003 22/25 interim),
  forecast = trailing-28-day revenue/4 from `pos_orders` + `orders`,
  FT priced at salary/26/7.5 + employer statutory, PT at hourly rate,
  rovers RM0 with a 2-shift/outlet-week quota, ⅓ rover-lead share
  (RM309/wk) added per outlet. Unit-tested.
- **Publish gate** (`api/hr/schedules/publish`): green publishes; amber
  (and unknown-forecast) requires a typed reason; red is owner-override
  only; rosters with profile-less or rate-less shifts are refused (422).
  Gate outcome + reasons append to `hr_schedules.ai_notes`;
  `estimated_labor_cost` / `total_labor_hours` stamp on every publish.
- **Editor badge** (schedules page): live labour-% chip (green/amber/red)
  repriced as shifts change, with cost, forecast, blockers and quota
  warnings in the tooltip; amber/red publishes prompt for the reason.
- **Monday digest** (`api/cron/labour-variance`, Mondays 09:30 MYT):
  per-outlet last-week labour % on actual revenue vs planned; ships in
  SHADOW (`LABOUR_VARIANCE_MODE`, log-only) until output is reviewed.

Still on the humans:
- HR profiles + rates for the 4 orphan-scheduled staff (Hidayat, Irfan,
  Haziq×2nd, Fatin — 61 June shifts between them). The gate blocks their
  outlets' publishes until done.
- Finalise the six `draft` 2026 payroll runs (closes the ~RM3k/outlet FT
  residual vs the workbook).
- Flip `LABOUR_VARIANCE_MODE=armed` after one shadow Monday looks sane.

## The Assignment (one concrete next step)
~~Reconstruct June-2026 labour % per outlet from live data.~~ DONE
2026-07-04 (see Verification Results): revenue exact, FT exact, PT found
in the finance GL (`6500-03` via `partimer` bank lines). Full June
reconstruction: 19.5% / 21.2% / 26.8% vs workbook 22.8% / 24.3% / 30.6% —
same ranking and verdicts; residue is the draft payroll runs +
payment-date vs week-worked timing. Next step is repair #1 (the
one-rule outlet-tag fix on the bank classifier) and repair #2 (profiles
for the 61 orphan shifts) — then the publish gate ships as designed.
