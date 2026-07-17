# Staffing model — how AI Fill sizes a roster from sales

The schedule generator (`apps/backoffice/src/lib/hr/agents/schedule-generator.ts`)
sizes staffing from throughput, split by station, to a serve-time target. This
is the same model presented to the HOO in the staffing report.

## Demand → heads

For each `(day-of-week, hour)` over the trailing 28 days, count items sold and
split by station:

- **Barista** = drinks + counter pastries (cakes, cookies, croissants) + any
  uncategorised item.
- **Kitchen** = cooked food only: Roti Bakar, Nasi Lemak, Pasta, Sandwiches,
  Fries, Noodle (`KITCHEN_CATEGORIES`).

Heads needed that hour:

```
heads = max(SERVICE_FLOOR, ceil(barista_items / barista_rate) + ceil(kitchen_items / kitchen_rate))
```

- Base rates: `8` = `BARISTA_ITEMS_PER_HR`, `6` = `KITCHEN_ITEMS_PER_HR` — items
  one head can make **and** serve per hour. The owner's service standard
  (2026-07-17): **kitchen food served ≤ 15 min, beverage/pastry ≤ 10 min.**

### Per-station shift allocation (owner rules 2026-07-17)

Day-split window counts run **once per station**, not on the pooled total:
kitchen (BOH) crew counts come from the kitchen item curve, barista/FOH counts
from the barista curve. The barista side additionally carries the service floor
(the store never trades below `SERVICE_FLOOR` total heads) and the
tight/mid/safe buffer — the cushion is counter/service, not the kitchen.

**Structural anchors** (`allocateStationCounts`, `STATION_ANCHOR_TARGET = 2`):
anchors carry work the item curve can't see — prep/setup at open, cleaning +
dishwashing at close — for BOTH stations. So each station seeds up to
**2 at opening AND 2 at closing before its curve places anyone else**; small
crews degrade gracefully (1 head opens; 2 split 1/1; 3 → 2 open / 1 close;
4 → 2/2). Only heads beyond 4 follow the demand curve.

Why per-station curves: kitchen items at a coffee outlet are morning-heavy
(Putrajaya 28d: ~6–7.5 cooked items/hr at 8:00–10:00, ~2–3/hr evenings), so a
**station Middle exists only when that station's items still need one** after
the anchors are covered. Before this rule, window counts were station-blind
beyond a 1-head anchor guarantee, so kitchen crew landed on Middles as surplus
artifacts.

The same per-station split powers the Assist coverage chips and the grid's
"+ Add" suggestions (`kitchen short 1` vs `barista short 1`) — a kitchen gap is
never reported as covered by a barista body.

### Serve-time self-calibration (no human judges "enough staff")

The base rates are only starting points. Every generation measures the outlet's
ACTUAL p90 serve time over the same trailing 28 days
(`pos_orders.created_at → served_at`, ~90% populated), split by station: an
order containing any cooked-food item is a **kitchen order** (15-min standard),
drinks/pastry-only orders are **barista orders** (10-min standard). Then
(`lib/hr/serve-time.ts`, pure + tested):

- **Breach** (p90 > target) → rate scales down by `target ÷ p90` (clamped ≥0.6)
  → the demand model asks for more heads at the loaded hours.
- **Comfortable** (p90 ≤ 70% of target) → rate nudges up 10% (leaner).
- **Deadband** in between → unchanged, so rates never flap week to week.
- Thin sample (<50 orders) → base rate stands.

Memoryless proportional control, computed fresh each run — no stored state, and
the calibration line lands in `ai_notes` so the reasoning is auditable. Staffing
changes feed the next window's serve times, closing the loop.

### Where the rates come from (prep times → serve target)

Owner-provided prep times: **drink / pastry ≈ 3 min, cooked food ≈ 10 min.**

- **Barista (8/hr).** A 3-min drink is ~20/hr of raw hands-on capacity, but the
  same head also takes orders, cashiers, serves, and cleans, and you must leave
  queue headroom — a station run at 100% utilisation grows an unbounded queue
  and serve time blows past 15 min. Net sustainable while holding the target ≈
  **8/hr**, consistent with the 3–4 heads the outlets actually run at.
- **Kitchen (6/hr).** A 10-min item against a 15-min target has almost **no
  headroom**: a single hand can start ~one item every 10 min = **6/hr** and
  still serve inside 15 min; a second order arriving in that window already
  pushes toward 20 min (under the 30-min ceiling, over the 15-min target). So
  the 10-min prep time *validates* 6/hr — and is precisely why a **2nd kitchen
  hand** is required as food volume rises (weekend brunch), not a barista.

Lever: to run leaner (accept serve time nearer 15 at peak) raise the barista
rate toward its ~12–20/hr raw ceiling; to protect serve time under surges,
lower it. Kitchen has little room to move without more hands.
- `SERVICE_FLOOR = 3` — never fewer than 3 on the floor while trading.

Consequence at current volumes: most hours read **3** (floor-bound), true peaks
read **4**. The 4th head is a **kitchen** hand on weekend mornings (brunch food
peak) and a **barista** in the afternoons (drink peak) — same headcount,
different station.

## Revenue forecast (the % denominator + affordable man-hours)

Both the labour-gate % and the man-hours "affordable" side read one forecast
(`lib/hr/revenue-forecast.ts`, fetched by `labour-gate.ts`):

- **Per weekday, recency-weighted.** Trailing `FORECAST_WEEKS` (4) of daily
  revenue, averaged per day-of-week with a geometric recency weight (½-life 2
  weeks) so the forecast *follows* a rising/falling trend instead of averaging
  it away. With equal weights it is arithmetically identical to the old
  trailing-28-days ÷ 4 (verified: reproduces RM23,814 for Putrajaya wk 2026-07-20
  to the ringgit), so weekend/weekday mix was always captured — recency is the
  new part.
- **Holiday-aware.** Public holidays (`hr_public_holidays`) are *excluded* from
  the weekday baseline (a Raya spike or a closure no longer distorts a normal
  Tuesday), and a holiday *in the target week* is scaled by the outlet's own
  historical holiday-vs-normal ratio — falling back to "same as a normal day,
  flagged" when there's no holiday history to learn from.
- **Per day, surfaced.** The gate returns each day's forecast + an *indicative*
  daily labour % (day hours × blended rate ÷ day forecast) so the grid shows the
  weekday-vs-weekend split. It's a coverage lens, not the billed figure — FT
  salary is a weekly fixed cost, so only the weekly % is the real number.

## Rotation cost split — cost follows the hours

A rotating FT's weekly salary share is charged to the outlet where the hours
actually land (`borrowedFtCharge` / `lentFtCredit` in `labour-gate-lib.ts`,
pro-rata over the 45h week, clamped so borrower charge + home remainder = one
share exactly). A shared FT working 6 days at a secondary outlet costs THAT
outlet their full share and their home outlet RM0 — no more flattering the
borrower while the home outlet pays for labour it never sees. The **Barista
Lead rover** follows the same rule: a working rover, costed pro-rata to each
outlet by the hours rotated there (replacing the old flat RM309
`ROVER_SHARE_WEEKLY`). Only **Manager / Area Manager / HoD** cost is HQ
overhead (RM0 to outlets), and they are never auto-scheduled — only the
Barista Lead rover auto-rotates (2 days/outlet-week).

## FT is sunk — schedule them fully, never bench to cut cost

Labour % = roster cost ÷ forecast, and roster cost splits into a **fixed** part
(FT salaries + rover — booked whether or not they're on the grid) and a
**discretionary** part (PT hours, the only spend the roster moves). Consequences
the tool now makes explicit:

- The gate returns `ftFixedCost` + `ptCost`; the labour chip tooltip shows the
  split (`FT floor X% fixed + PT Y%`), so it's clear that **benching an FT saves
  nothing** — it only loses coverage. It flags a **warning** when a primary FT is
  scheduled well below their 6-day capacity (net of leave): idle paid capacity.
- When the FT floor alone is already ≥ target (PT envelope = RM0), the generator
  notes the week is **revenue-constrained** — a revenue/FT-deployment problem,
  not a rostering one; the fix is more revenue or lending an idle FT to a busier
  outlet, never trimming FT hours.

## Required man-hours

`required man-hours/day = Σ heads over the open hours` (captures peaks, not a
daily average). Compared against **affordable** man-hours
(`revenue × target% ÷ blended rate`); a positive gap flags a day that can't be
both covered and under budget (usually a quiet, floor-bound day — a revenue
problem, not a rostering one). Surfaced in `ai_notes`.

## Where it flows

The hourly `demand` map drives: FT rest-day weighting (rest on the quietest
days), the PT top-up target (`required − FT base`, weekends first), and the
man-hours / peak-heads notes. FT fairness + anti-fatigue rules (no close→open,
rotated anchors, rotated weekend rest) sit on top.

## Which PT fills a gap — demand, then fairness + performance

The demand model decides *how many* PT hours a day needs; a separate ranking
decides *who* gets suggested for each gap. Three signals blend (both the LLM
pass and the greedy fallback use them; `lib/hr/pt-performance.ts`):

- **Fairness** — trailing 4-week rostered hours; fewer → higher priority. Updates
  live as the run proposes, so hours spread instead of piling on one person.
- **Performance** — a 60-day reliability score: on-time rate (clock-in vs
  scheduled, `hr_attendance_logs`) blended 60/40 with checklist-completion rate
  (`Checklist`). Between two equally under-worked PTs the more reliable one is
  preferred. Bayesian-shrunk (prior 0.7–0.8, K 3) so a thin/no history sits at a
  neutral prior and is never hard-blocked — it's a nudge, not a gate.
- **Cost** — cheaper hourly rate breaks remaining ties, inside the RM envelope.

Every suggestion is still validated against the hard caps (24h / 5-day combined
across outlets, one shift/day, budget) and confirmed by the manager. The per-PT
scores are surfaced in `ai_notes`.

## Staffing mode — Tight / Mid / Safe

AI Fill takes a `mode` (default `tight`). The demand **sizing** is identical in
all three; the mode only sets a coverage buffer laid on top of the sized heads,
applied through a single lever (`bufferHeads(dow, hour)` in the generator) so
required man-hours, the peak note, the PT demand gaps and the PT top-up target
all move together:

- **Tight** — no buffer. Staff exactly to the sized heads; serve time ~15 min at
  peak, labour ~target%. No slack for a break or a no-show. (Buffer 0 → identical
  to the pre-toggle behaviour.)
- **Mid** — **+1 head across the day's peak block** (the hours at that day's peak
  demand). Relief at the busy window; labour ~1 point higher.
- **Safe** — **+1 head across the whole open window**: break cover all day plus
  one no-show of slack. Serve time <12 min at peak; labour a few points higher.

The buffer only produces a PT suggestion where a genuine gap exists (buffered
need > heads already on the floor); the RM envelope and the 24h/5-day PT caps
still bound it, so Safe can't blow the budget. The mode is chosen in the
Schedules toolbar (dropdown beside **AI Fill**), recorded in `ai_notes`, and
returned on the generate result.

Break *times* are still surfaced as suggested lulls in `ai_notes` only (placed
case by case in the grid) — persisting an explicit break column
(`hr_schedule_shifts.break_start`) is deliberately out of scope.

## Lessons

- Item volumes at these outlets are low relative to the 3-person floor, so
  staffing is **floor-bound** most hours — the throughput split matters for
  *where* the 4th head goes (station) and *when* (peak), not for the baseline.
