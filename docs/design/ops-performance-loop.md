# Ops Performance Loop — Execution (lead) → KPI (lag) over WhatsApp

_Office-hours diagnostic — 2026-06-28. Owner: Ammar._
_Parent/strategic frame for [[ops-kpi-pulse-loop]]. Reframes the pulse as a 4DX performance system, not a notifier._

## Problem Statement
Operational standards slip silently and are found out late or never (checklist skipped,
phone not captured, bad review dead-ends, serving drags). The owner's thesis: **if we
communicate the miss over WhatsApp in real time, staff will improve and rectify on the spot.**
The diagnostic below tests that thesis, frames every process as a 4DX **lead measure**
(execution behaviour you can nudge) vs **lag measure** (the KPI it moves), and narrows to the
one wedge worth proving first.

## Demand Evidence (interrogated, not assumed)
- **The thesis is currently a bet, not evidence.** The daily pulse went live 2026-06-25; as of
  this diagnostic **no behaviour change has been observed** — delivery is still gated on the
  WhatsApp 24h window (no approved templates) and no one has meaningfully acted on a message.
  So the channel isn't even reliably *delivering* yet, let alone proven to change behaviour.
  → Implication: going wide (15 detectors → WhatsApp) scales an unproven, undelivered loop.
  Prove the channel + the loop on ONE measure first.
- **The pain is real and large (data, not opinion).** Phone-capture across the 3 trading
  outlets over the last 14 days (3,469 completed orders): **32.7% overall** — far below the
  60% floor / 80% target. ~1,100 customers/14d uncaptured at the worst outlet alone. Every
  uncaptured phone is a customer made permanently invisible to win-back, frequency, birthday,
  and attribution ([[project_marketing_goals]], [[project_sms_loop_engineering]] — "phone is the
  join key").

## Status Quo (what users do now — the real competitor)
The competitor is **NOT "no communication" — it's an existing WhatsApp group** managers post in,
which is *inconsistent* and has *no follow-through*. That matters two ways:
1. **The channel is already won.** Staff live in WhatsApp; we're upgrading a habit, not creating
   one. (Point in favour of the thesis.)
2. **The group fails at exactly the two things 4DX requires:** a **scoreboard** (you cannot see
   "am I winning?" in a chat feed) and **closure** (no ownership, no cadence, no follow-through).
   A miss-ping stream has the same defect — it becomes spam and is muted in ~2 weeks (the failure
   mode [[ops-kpi-pulse-loop]] already documents).
→ **Our edge over the status quo is not the channel. It's making it scored and closed-loop.**
   Scoreboard-first, ping-second.

## The 4DX correction (the framing the build must follow)
The owner's examples (checklist, attendance, phone, review) are almost all **lead measures**.
Lead measures are the only thing you can nudge; each must chain to the **one lag (KPI)** it moves:

| Lead (execution — nudgeable) | Lag (KPI — outcome) |
|---|---|
| Phone-capture rate | Repeat-order revenue (the join key) |
| Checklist completion on time | Consistency / food-safety → rating, repeat |
| Serving time < 10 min | Throughput + experience → AOV, repeat |
| Review reply + recovery within SLA | Avg rating, recovery rate, repeat-from-recovered |
| On-time clock-in / coverage | Labour vs sales, speed → profit |

The loop is real only when it has the full 4DX spine: a **WIG** (one lag that matters), **lead
measures** the team owns, a **scoreboard** readable in 5 seconds, and a **cadence of
accountability** (a weekly look-at-the-number). WhatsApp is the *delivery surface* for the
scoreboard and the cadence — not the intervention itself.

## The "signal must be true" landmine (process audit result)
A performance loop on a measure that doesn't fire is noise that *poisons the channel* for the
measures that do. Audit of every operational process (full inventory in the appendix below):

- 🟢 **CLEAN & LIVE (loop-ready now):** phone capture, serving time (`pos_orders.ready_at/served_at`,
  register alarm already fires), checklist completion, bad-review rectification (reply+recovery
  timestamps), wastage %, menu-86, per-cashier upsell.
- 🟡 **NOISY / STALE:** stock-count cadence + variance (counts stale, baseline junk), par/reorder
  (par levels never auto-recalc'd), COGS-vs-target (supplier prices static), receiving/PO aging
  (RM112k stuck, no aging view).
- 🔴 **DARK / BLOCKED — DO NOT BUILD ON THESE YET:** **staff attendance** (clock-in adoption ~18%
  — 4 of 22; the signal is 82% null), **leave/OT** (staff-app HR locked since 2026-05-20, zero
  submissions; approved OT doesn't even reach payroll), competitor-rank/geogrid (Places API key
  gated).

**The owner's headline example — "staff attendance" — is the single worst wedge.** Nudging 18
people about a clock-in tool they don't use is spam that trains the whole team to mute WhatsApp.
Attendance is a *fix-the-signal-first* problem, not a loop-it problem.

## Target User (named)
- **The cashier whose behaviour must change** — e.g. **Irfan** (Conezion, 330 orders/14d, 15.5%
  capture) and **Afique** (12.3%). What the loop must make them feel: their number, on a board,
  next to their peers, every shift.
- **The accountable coach** — the **Conezion outlet manager** (the person who runs that crew).
  The scoreboard is the artefact they review *with* the cashier; the escalation lands on them.
- **Ammar (owner)** — scorecard reader + escalation target. Finds out too late today.

## Narrowest Wedge
**Phone-capture, Conezion only, per-cashier scoreboard + daily nudge + weekly WIG review.**
Why Conezion and why phone capture (all evidence-backed):
- **Maximum room × maximum volume = fastest proof.** Conezion: 1,378 orders/14d (~98/day),
  **18.5%** capture (the worst), 8 cashiers.
- **Built-in benchmark + control.** Shah Alam runs the *same system* at **58.9%** — proof the
  ceiling is reachable. **Tamarind** (~19.7%, similar baseline) is the natural **control**: if
  Conezion climbs and Tamarind stays flat, the loop — not the weather — did it.
- **The gap is systemic, not a few zeros** (so coaching the crew, not firing one person):
  Firdaus 20.8 / Irfan 15.5 / Nurul 18.1 / Afique 12.3 / Hafifie 23.9 / **Badri 47.3** /
  unattributed-logins **0.0** (95 orders). Badri is the internal "here's how"; the unattributed
  95 are a data-hygiene fix (shared logins → 0% by construction).
- **Phone capture is the strategic crown jewel** — the join key for every downstream marketing
  loop — and is already instrumented end-to-end (`pos_orders.customer_phone` / `loyalty_phone`,
  `employee_id`, `shift_id`; detector `detectPhoneCapture` live).

## Premises (verify before/while building)
1. **Per-cashier attribution works.** ✅ Verified — `pos_orders.employee_id` joins to `User.name`;
   per-cashier capture computed above. (Fix the ~95 unattributed orders/14d at Conezion — a
   shared/kiosk login pattern — or they sit at a structural 0%.)
2. **Delivery can be guaranteed for a 4-person pilot without Meta approval.** Have the Conezion
   manager + the crew message the bot once to open each 24h window; or approve the one
   `ops_*` template. (The pilot does NOT wait on template approval.)
3. **`outlet_id` is a slug** (`outlet-con/-sa/-tam`), not `Outlet.id` — scoreboard queries key
   on the slug. Nilai isn't trading on POS-native (absent from 14d data).
4. **Capture = `customer_phone` OR `loyalty_phone` present.** Confirm that's the right definition
   (loyalty members auto-fill; a "skip" should count as a miss, not a capture).

## Approaches Considered

### Approach A — Phone-capture scoreboard loop, Conezion only (days) — RECOMMENDED
Reuse the live detector + OpsAlert ledger + the workspace. Add the three things the status quo
lacks: (1) a **guaranteed-delivery path** (open the 24h window for the ~4 Conezion people);
(2) a **per-cashier + per-shift capture SCOREBOARD** — end-of-shift "your number vs target vs
the crew", plus a mid-shift nudge if the rolling rate is under floor (the *remind* beat); (3) a
**weekly WIG review** message (trend + commit-to-one-action). Tamarind = untouched control.
Deliverable: a moving number AND a delivery+engagement-proven channel — the template you clone.

### Approach B — Clean-signals performance pack, all outlets (weeks)
After A proves the model, clone the loop shape to the other 🟢 measures (serving time, checklist,
review rectification, wastage) and all outlets, on one unified per-person weekly scoreboard +
the existing escalation. Still excludes every 🔴 dark signal.

### Approach C — Full ops performance system incl. attendance/leave/stock (months) — DEFER
Everything — but only after the 🔴/🟡 signals are *repaired* (unblock staff-app HR/RLS, drive
clock-in adoption > 60%, fix the stock-count baseline). These are **prerequisites, not features**:
loop them today and you get noise. Defer until the clean loops prove the model and the data
foundations are fixed.

## Recommended Approach
**A.** It directly answers the only open question that matters right now — *does a WhatsApp
scoreboard actually move the number?* — on the highest-room, highest-volume, fully-instrumented
measure, with a built-in control (Tamarind) and benchmark (Shah Alam). Evidence that would flip
the rec: if capture were already near target everywhere (it isn't — 18–20% at two outlets), or
if per-cashier attribution were impossible (it isn't), the wedge would change.

## Open Questions
1. **Scoreboard destination:** post the per-cashier board to the existing outlet WhatsApp group
   (peer pressure is a 4DX *feature*) vs DM each cashier (privacy)? Recommend **public team
   scoreboard + private coaching DM** for a laggard.
2. **Cadence:** end-of-shift + weekly is the spine; is a *mid-shift* nudge welcome or naggy at
   Conezion? (Pilot will tell.)
3. **What "good" looks like:** target 80%, floor 60% — or stage it (Conezion: 18% → 40% in 2
   weeks → 60% in 4)?
4. Fix the unattributed-login 0% bucket — is it a shared till login, Grab orders, or kiosk?

## Success Criteria (measurable)
- **Channel proven:** ≥ 90% of scoreboard/nudge messages delivered (not stuck outside window)
  across the 2-week pilot.
- **Engagement proven:** the Conezion manager acts on the weekly review (acks + names one action)
  ≥ 2 of 2 weeks; ≥ 1 cashier's number visibly responds.
- **The number moves:** Conezion capture rises from 18.5% baseline toward Shah Alam's ~59%,
  **faster than Tamarind (control)** over 4 weeks.
- **Lag signal (longer):** identified-customer share of orders ↑; repeat-order rate ↑ at Conezion.

## Decisions (owner, 2026-06-28)
1. **Commit to ALL angles** — but "commit" = two actions: 🟢 live signal → build the loop now;
   🔴 dead signal → **fix the signal first** (repair track), join the board when real. No WhatsApp
   on dead signals (it poisons the channel).
2. **Rollout: all outlets + all clean angles at once** (owner overrode the staged-Conezion rec —
   accepted: no control group, no soft-launch to catch a bad cadence). → templates become the hard
   delivery gate (free-form silently fails outside the 24h window for ~22 staff).
3. **Architecture = one role-scoped scoreboard, not 15 ping streams.** Each person sees only their
   2-3 numbers. One weekly cadence + the existing real-time incident lane. Cadence of accountability
   (weekly per-outlet review) is the engine; messages are its surface.

## Build (started 2026-06-28)
Reuses the EXISTING engine — do not rebuild:
- `/api/scorecard` already computes per-OUTLET capture / upsell / checklist / wastage / serving
  vs `KPI_TARGETS` (collection 70, upsell 10, ops 90, wastage ≤3, serving 15) and ranks outlets.
  Extracted its body into `computeScorecard(period)` so the cron shares the exact dashboard numbers.
- `/api/pos/cashier-scorecard` already powers a LIVE on-register capture chip — so cashiers ALREADY
  see their capture % in the moment. The WhatsApp layer adds the per-shift/week summary + the
  manager/owner cadence + the angles not on the register (checklist/reviews/wastage).
- Capture metric = `pos_orders.loyalty_phone` (matches the dashboard + register chip), NOT the
  `customer_phone OR loyalty_phone` used in the baseline scan — so the true cashier-capture number
  is *lower* than the 33% headline (grab/pickup auto-carry customer_phone). Wedge is even stronger.
- New `lib/ops-scoreboard/`: compute (per-cashier capture+upsell over a period) + render (cashier DM
  board, manager outlet board, owner league table) + index (`runScoreboard`, shadow/armed via
  `OPS_SCOREBOARD_MODE`). Cron `/api/cron/ops-scoreboard` weekly. Ships in **shadow** (logs the
  boards it would send, no WhatsApp) — same safety pattern as ops-pulse.
- Remaining angles (serving/checklist/wastage/review-SLA) plug into the same render as added measures;
  the repair track (attendance/leave/stock) is a separate workstream below.

### Shipped 2026-06-28 — scoreboard loop in SHADOW (typecheck clean, proven on live data)
Files: `lib/ops-scoreboard/{cashiers,render,index}.ts`, `sendScoreboard` in ops-pulse/sender,
`ops_scoreboard` template (config + create endpoint), cron `/api/cron/ops-scoreboard` (Mon 09:00 MYT),
`computeScorecard`/`resolvePeriod` extracted+exported from `/api/scorecard/route`. `OPS_SCOREBOARD_MODE`
(off|shadow|armed, default **shadow**).
- **Shadow run against live data succeeded:** 15 cashier DMs + 3 leader recipients (owner Ammar +
  ops leads Ariff/Adam), `sent: 0`. Real boards, e.g. cashier Irfan "capture 17% (tgt 70%) · upsell
  1% · crew 30% · top Nor 69%"; per-cashier spread 17%→69% (top = Nor Armin Hafifie 69% = the internal
  "here's how"). Leader league: Shah Alam 60% · Putrajaya 20% · Tamarind 20% · avg capture 42%.
- Capture redefined to `loyalty_phone` (dashboard/register definition) — crew ~30% cashier-rung, vs
  the 33% headline scan (which over-counted via customer_phone). Wedge confirmed even stronger.
- **To arm:** approve `ops_scoreboard` (+ the other ops_* templates) via `/api/ops/workspace/templates?action=create`
  → set `OPS_SCOREBOARD_MODE=armed`. Delivery still bound by the 24h window until templates approve.
- **Not yet built (next):** serving/checklist/wastage/review-SLA measures on the cashier/manager boards
  (engine already computes outlet-level serving/checklist/wastage — wire into render); a Scoreboard tab
  in the Ops Workspace; the dark-signal **repair track** (attendance adoption, staff-app HR/RLS unblock,
  OT→payroll sync, stock-count baseline + par recalc).

## Repair track — Leave/OT pipeline (started 2026-06-28)
Owner picked the Leave/OT pipeline as the first dark-signal repair ("build path, I approve").

**Verified ground truth (live DB, not memory):** clock-in adoption ~15% (58 clock-ins / 393
scheduled shifts/14d, 11 of 47 rostered users). Leave + OT submissions BOTH died ~2026-04-18/19,
**a month before** the May-20 RLS lockdown — so "RLS broke it" was wrong; the killer was
**learned helplessness**: 81 OT requests submitted, **0 ever approved**, ~1h OT reached payroll in
60d. Rostering itself works. Stock counts 25–38d stale (target 7d).

**Root cause (precise):** `payroll-calculator.ts` reads OT **only** from `hr_attendance_logs`
(in pay month, `final_status != rejected`, OT-approved, `overtime_hours >= 1`). It **never reads
`hr_overtime_requests`** — so the whole OT-request system (the 81, the `/hr/overtime` approval UI)
was **orphaned from pay**. Approving only set `hours_approved` on a row nothing pays from.

**Built — the missing link** (no schema change): `lib/hr/ot-payroll-sync.ts` +
wired into the OT approval `PATCH /api/hr/overtime-requests`. On approve/partial it lands the
approved hours on the attendance log payroll reads — updating the real (user, date) log if one
exists, else **creating an OT-only payable log** (`clock_in_method='ot_approval'`, regular 0,
marked approved) so OT pays even on no-clock-in days. Idempotent per (user, date); never stacks a
synthetic log on a real one (no double-count); reject/cancel retracts only the synthetic log.
ot_type→overtime_type map handles 1x/1.5x/2x/3x cleanly; ⚠ rest_day/public_holiday are best-effort
(flagged in code) — but read-only check shows the **entire 81-request backlog is `1.5x`**, so this
doesn't bite now. Response now returns `payrollSynced` so the UI can warn on failure. Typecheck clean.

**Backlog preview (read-only):** approving the 81 → all 81 update real April logs (0 synthetic, all
1.5x, none <1h). ⚠ **Process step beyond code:** April/May payroll runs are stuck `ai_computed`
(never confirmed) — approving the OT fixes the data, but someone must (re)compute/confirm those runs
to actually pay it.

**Not done (OT/leave):** re-open staff submission (died April; demand returns once OT visibly pays) —
owner parked this for now.

## Repair track — clock-in + stock (2026-06-28)
Owner: do clock-in + stock next; OT/leave parked. Same principle — make each an OWNED manager
number (not dead per-incident pings).

**Verified ground truth (live, 7d):** clock-in compliance Putrajaya **0%** (0/110 shifts), Tamarind
**4%** (2/56), Shah Alam **66%** (21/32) — same management-discipline spread as capture, on the same
system. Stock counts: Shah Alam 38d stale, Putrajaya/Tamarind 25d (target ≤7d). Key insight:
Putrajaya 0 clock-ins on 110 shifts = staff aren't *trying*, not getting *blocked* — so the geofence
isn't the bottleneck; manager ownership is.

**Built:**
- **Clock-in compliance + stock-count freshness as MANAGER scoreboard measures** —
  `lib/ops-scoreboard/ops-health.ts` (`computeOpsHealth`: clock-ins ÷ scheduled shifts per outlet;
  days since last SUBMITTED/REVIEWED count; keyed on Outlet.id) wired into `renderManagerBoard` +
  the leader digest. Targets: clock-in 80%, stock ≤7d. Now the manager sees "Clock-in 0% (tgt 80%)
  ✗ / Stock count 25d ago ✗" every week and owns moving it. Shadow run clean (cron ok, executes on
  live data). This is the adoption engine for both dark signals — no false no-show spam.
- **Geofence hard-block → soft control** (`apps/staff/.../api/hr/clock/route.ts`): out-of-zone /
  no-GPS clock-ins are now ALLOWED but tagged (`clock_in_method` = `app_offsite`/`app_nogps`) + a
  `warning` returned, instead of a 403/400 lockout. Matches the company soft-controls policy
  ([[feedback_staff_ops_soft_controls]]) and removes a friction that suppressed adoption. Audit
  trail preserved (lat/lng + method) for attendance review to flag. Both apps typecheck clean.

**Not done (next):** stock-count expected-qty baseline fix + par-level recalc cron (par/reorder
points are computed manually, never on a schedule — `/api/inventory/par-levels/calculate` is POST-only).
Note: par recalc makes reorder *thresholds* current but the reorder *signal* still needs counts done
(StockBalance freshness) — which the scoreboard measure now drives.

### Real-time staff+manager nudges (2026-06-28) — BUILT, shadow
Owner: "send WhatsApp if no clock-in / no stock count → staff AND manager." Settings: stock = no
count in **3 days** (then daily until done); clock-in = **once per missed shift**. The ACTIVE push
that complements the passive weekly scoreboard.
- `lib/ops-nudges/` reuses the pulse detectors (detection) + the OpsAlert ledger (dedupe — each
  no-show/outlet nudged at most once per day) + the WhatsApp sender, with tailored per-recipient
  copy: gentle 1st-person to staff ("Hi X, you're on shift… please clock in"), factual digest to the
  manager. `OPS_NUDGES_MODE` (off|shadow|armed, default shadow).
  - **Clock-in:** `findNoClockInBreaches` (refactored ungated out of `detectNoClockIn`, so the nudge
    fires without flipping the pulse's NOCLOCKIN gate) → DM the no-show + digest to ops leads.
    Cron `/api/cron/ops-nudge-clockin` once daily (~8:30am MYT — catches the main
    morning shift, low cost; ledger still dedupes per staff/day).
  - **Stock:** follows the owner's Stock Count schedule (`appConfig.stock_count_schedule`:
    weekly count days + month-end full-count dates, Settings → Stock Count). On a scheduled
    day, DM the on-shift team (`resolveOutletTeam`) + digest to ops leads for outlets that
    haven't logged a count that day; silent off-schedule. Cron daily (schedule gates sending).
  - "Manager" = ops leads (Ariff/Adam) until an outlet→manager map exists. Templates: `ops_nudge`.
- **Shadow run on live data (proof):** clock-in 8 real no-shows after fix (Badri, Ameir Haziq,
  Tengku Syahirah, Atthirah…), each DM'd + an 8-line digest to Ariff/Adam; stock 4 outlets
  (Putrajaya 25d/team 13, Tamarind 25d/team 6, Shah Alam 38d/team 4, Nilai no-count/empty
  team→manager-only). 0 sent.
- **Bug caught by shadow + fixed:** roster has **00:00 placeholder start_times** → were producing
  nonsense "clock in for your 00:00 shift" nudges (11 → 8 after filtering 00:00 in
  `findNoClockInBreaches`). Classic shadow-first catch. ⚠ Still open: managers (e.g. Adam Kelvin)
  appear as both a no-show and a digest recipient — left as-is (managers clock in too); revisit if noisy.

## The Assignment (one concrete next step)
Baseline is already pulled (this doc). Next, before building the scoreboard renderer:
**open the delivery path and watch one cycle.** Have the Conezion manager + the 4 top cashiers
(Firdaus, Irfan, Nurul, Afique) message the WhatsApp bot once today (opens their 24h window),
then manually send them tomorrow's end-of-shift capture board ("you: X% · crew: 18% · target:
80% · Badri: 47%"). Watch whether the number moves the next day **before** automating anything.
If a hand-sent scoreboard doesn't move it, no amount of automation will.

---

## Appendix — Full process inventory (lead/lag, by domain)
Source: code audit 2026-06-28 (`pos_orders`, `Checklist`, `InternalFeedback`/`ReviewReplyDraft`,
`StockCount`/`Receiving`/`Order`, `hr_*`). Status legend: 🟢 clean & live · 🟡 noisy/stale ·
🔴 dark/blocked.

### POS / order / speed-of-service
| Process | Lead | Lag | Source | Status |
|---|---|---|---|---|
| Phone capture | % orders w/ phone, per cashier/shift | Repeat-order revenue | `pos_orders.customer_phone/loyalty_phone, employee_id, shift_id` | 🟢 |
| Serving time | ready/served within 10 min | Avg serving time, % > 15 min | `pos_orders.ready_at/served_at`, `orders.ready_at`; register alarm `use-serving-alarm.ts` | 🟢 |
| Till open on time | `pos_shifts.opened_at` < outlet openTime | % days opened on time | `pos_shifts.opened_at` | 🟢 (no detector yet) |
| Menu 86'd | items toggled unavailable | availability %, time-in-86 | `outlet_product_availability.is_available` | 🟢 |
| Refund/void discipline | refund/void events | refund rate % | `pos_orders.status, refund_of_order_id` | 🟢 (no detector) |
| Upsell / pair | offer accepted, per cashier | upsell rate %, AOV lift | `pos_pair_events.employee_id` | 🟢 |
| Wastage | adjustment logged | wastage % of sales | `StockAdjustment` | 🟢 |

### Reviews / reputation
| Process | Lead | Lag | Source | Status |
|---|---|---|---|---|
| Bad-review rectification | reply posted < SLA | response rate %, avg rating | `ReviewReplyDraft.createdAt/decidedAt`, `ReviewDailySnapshot` | 🟢 |
| Recovery loop | codes issued/claimed | redemption %, repeat-from-recovered | `ReviewReplyDraft.recoveryCode/claimedAt/redeemedAt` | 🟢 (POS redemption link partial) |
| Internal QR feedback | negative resolved | rating dist, days-to-resolve | `InternalFeedback` | 🟢 |
| Review volume/recency | reviews/day | rank status vs competitor | `ReviewDailySnapshot` | 🟡 (competitor side needs Places key) |
| Geogrid local rank | scans/month | avg rank, % top-3 | `GeoGridScan` | 🔴 (Places key gated) |

### Procurement / stock
| Process | Lead | Lag | Source | Status |
|---|---|---|---|---|
| Stock-count cadence | count submitted in window | % outlets compliant | `StockCount.countDate/status` | 🟡 (counts stale, baseline junk) |
| Receiving discipline | received vs disputed/partial | discrepancy rate, days-to-receive | `Receiving.status/receivedAt` | 🟡 |
| PO aging / chase | days in AWAITING_DELIVERY; supplier-agent actions | % POs late, on-time delivery | `Order.status/sentAt`, supplier-chat-agent `WhatsAppMessage.raw` | 🟡 (no aging view; RM112k stuck) |
| Par/reorder | reorder-point breach acted | days-to-order, stockouts | `StockBalance` vs `ParLevel` | 🟡 (par never auto-recalc'd) |
| COGS vs target | n/a | margin %, COGS % of sales | `MenuIngredient × SupplierProduct`, `SalesTarget` | 🟡 (prices static; ~55% vs 35% target) |
| Duplicate PO / double-pay | flags raised | $ caught, false-positive rate | `Invoice.flags`, `Order.clientRequestId` | 🟢 (guard live) |

### HR / attendance / labour
| Process | Lead | Lag | Source | Status |
|---|---|---|---|---|
| Clock-in adoption / on-time | clock-in vs scheduled start | no-show %, late % | `hr_attendance_logs` × `hr_schedule_shifts` | 🔴 (~18% adoption → 82% null) |
| Roster publishing | schedule published/outlet/week | % outlets rostered | `hr_schedules.status` | 🔴 (3 of 5) |
| Leave / OT submission+approval | request → approval turnaround | approval SLA | `hr_leave_requests`, `hr_overtime_requests` | 🔴 (staff app locked since 2026-05-20; OT not synced to payroll) |
| Cert / skill expiry | reminder stages fired | % staff current | `hr_certifications`, cert-expiry cron | 🟢 (reminders) / 🟡 (no enforcement) |
| Review penalties | GBP ≤2★ → penalty row | $ penalty/staff | `hr_review_penalty` | 🟡 (not deducted in payroll) |
