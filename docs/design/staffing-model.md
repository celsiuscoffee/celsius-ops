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
  (30-minute hard ceiling). All-in (make, serve, clean, till), calibrated to the
  3–4 heads the outlets actually run — NOT stopwatch-measured. Change the
  constants to recalibrate.
- `SERVICE_FLOOR = 3` — never fewer than 3 on the floor while trading.

Consequence at current volumes: most hours read **3** (floor-bound), true peaks
read **4**. The 4th head is a **kitchen** hand on weekend mornings (brunch food
peak) and a **barista** in the afternoons (drink peak) — same headcount,
different station.

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

## Tight vs Safe (report framing)

- **Tight** — staff exactly to the sized heads; serve time ~15 min at peak,
  labour ~18%. No slack for a no-show.
- **Safe** — one extra hand across the peak block + break cover; serve time
  <12 min, labour a few points higher.

The generator currently produces the Tight-style floor + demand-shaped PT
top-up. A `mode: 'safe'` buffer (extra peak head + explicit break-time
placement) is the next increment — break *times* need a shift column
(`hr_schedule_shifts.break_start`, migration TBD); today AI Fill emits suggested
break lulls in `ai_notes` only.

## Lessons

- Item volumes at these outlets are low relative to the 3-person floor, so
  staffing is **floor-bound** most hours — the throughput split matters for
  *where* the 4th head goes (station) and *when* (peak), not for the baseline.
