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
heads = max(SERVICE_FLOOR, ceil(barista_items / 8) + ceil(kitchen_items / 6))
```

- `8` = `BARISTA_ITEMS_PER_HR`, `6` = `KITCHEN_ITEMS_PER_HR` — items one head can
  make **and** serve per hour while holding a **15-minute serve target**
  (30-minute hard ceiling). Change the constants to recalibrate.

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
