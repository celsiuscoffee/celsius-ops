// Outlet "ops health" measures the main scorecard engine doesn't compute:
// clock-in compliance and stock-count freshness. These are the two dark-signal
// adoption metrics — surfaced on the MANAGER board as owned numbers (4DX), which
// is how adoption actually rises (Shah Alam runs clock-in at ~66% on the same
// system Putrajaya runs at 0%). NOT per-incident no-show pings (noise at 15%
// adoption) — an aggregate the manager is accountable to move.
//
// Keyed by Prisma Outlet.id (the same key the scorecard rows use):
//   - clock-in: hr_schedule_shifts (via hr_schedules.outlet_id) vs hr_attendance_logs.outlet_id
//   - stock:    latest StockCount.countDate per outlet
// Both HR ids are Outlet.id (confirmed: the join to "Outlet".name resolves).

import { prisma } from "@/lib/prisma";
import type { ScorecardPeriod } from "@/app/api/scorecard/route";

export const CLOCKIN_TARGET_PCT = 80;
export const STOCK_MAX_DAYS = 7;

export interface OutletOpsHealth {
  clockInPct: number | null; // clock-ins ÷ scheduled shifts over the period
  scheduledShifts: number;
  clockIns: number;
  daysSinceCount: number | null; // since the latest SUBMITTED/REVIEWED count
  lastCountDate: string | null;
}

export async function computeOpsHealth(p: ScorecardPeriod): Promise<Map<string, OutletOpsHealth>> {
  const [sched, clk, counts] = await Promise.all([
    prisma.$queryRaw<Array<{ outlet_id: string; shifts: number }>>`
      SELECT sc.outlet_id, COUNT(*)::int AS shifts
      FROM hr_schedule_shifts s
      JOIN hr_schedules sc ON sc.id = s.schedule_id
      WHERE s.shift_date >= ${p.fromDate}::date AND s.shift_date <= ${p.toDate}::date
      GROUP BY sc.outlet_id
    `,
    prisma.$queryRaw<Array<{ outlet_id: string; clockins: number }>>`
      SELECT outlet_id, COUNT(*)::int AS clockins
      FROM hr_attendance_logs
      WHERE clock_in >= ${p.fromISO}::timestamptz AND clock_in <= ${p.toISO}::timestamptz
        AND outlet_id IS NOT NULL
      GROUP BY outlet_id
    `,
    prisma.stockCount.findMany({
      where: { status: { in: ["SUBMITTED", "REVIEWED"] } },
      select: { outletId: true, countDate: true },
      orderBy: { countDate: "desc" },
    }),
  ]);

  const shiftsBy = new Map(sched.map((r) => [r.outlet_id, Number(r.shifts)]));
  const clockBy = new Map(clk.map((r) => [r.outlet_id, Number(r.clockins)]));
  const lastCountBy = new Map<string, Date>();
  for (const c of counts) {
    if (!lastCountBy.has(c.outletId)) lastCountBy.set(c.outletId, c.countDate); // first = latest (sorted desc)
  }

  const now = Date.now();
  const outletIds = new Set<string>([...shiftsBy.keys(), ...clockBy.keys(), ...lastCountBy.keys()]);
  const out = new Map<string, OutletOpsHealth>();
  for (const id of outletIds) {
    const shifts = shiftsBy.get(id) ?? 0;
    const clockins = clockBy.get(id) ?? 0;
    const last = lastCountBy.get(id) ?? null;
    out.set(id, {
      scheduledShifts: shifts,
      clockIns: clockins,
      clockInPct: shifts > 0 ? Math.round((clockins / shifts) * 100) : null,
      lastCountDate: last ? last.toISOString().slice(0, 10) : null,
      daysSinceCount: last ? Math.floor((now - last.getTime()) / 86_400_000) : null,
    });
  }
  return out;
}
