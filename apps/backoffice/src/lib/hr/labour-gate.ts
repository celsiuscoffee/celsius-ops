// IO half of the labour-cost gate: revenue forecasting + schedule pricing.
// Pure costing/verdict logic lives in labour-gate-lib.ts (unit-tested there).

import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import {
  costRoster,
  shiftHours,
  verdictFor,
  weeklySalaryShare,
  OUTLET_BUDGETS,
  DEFAULT_BUDGET,
  borrowedFtCharge,
  lentFtCredit,
  type LabourGateResult,
  type ShiftCostRow,
} from "@/lib/hr/labour-gate-lib";
import { buildWeekForecast, FORECAST_WEEKS, type WeekForecast } from "@/lib/hr/revenue-forecast";
import { computeWeekDemand } from "@/lib/hr/demand";

export * from "@/lib/hr/labour-gate-lib";

// pickup-app `orders.store_id` per loyalty outlet id (`pos_orders.outlet_id`).
const PICKUP_STORE_BY_LOYALTY: Record<string, string> = {
  "outlet-con": "conezion",
  "outlet-sa": "shah-alam",
  "outlet-tam": "tamarind",
  "outlet-nilai": "nilai",
};

// Forecast the coming week's revenue from trailing daily history, per weekday,
// recency-weighted and holiday-adjusted (see revenue-forecast.ts). Returns the
// full per-day breakdown; `forecastWeekRevenue` is the weekly-total convenience
// wrapper the budget envelope uses. Sources are the in-house POS (`pos_orders`,
// GrabFood included) + the pickup app (`orders`) + StoreHub (retired
// 2026-06-17; zero after, keeps trailing windows honest during the cutover).
export async function forecastWeek(
  outlet: { id: string; loyaltyOutletId: string | null },
  weekStart: string,
): Promise<WeekForecast> {
  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) weekDates.push(addDays(weekStart, i));
  const histStart = addDays(weekStart, -FORECAST_WEEKS * 7);
  const histEnd = addDays(weekStart, -1);

  const series = await dailyRevenueSeries(outlet, histStart, histEnd);
  // Fill EVERY day in the window (0 when no sales) so a closed/dead day counts
  // as a real 0 in its weekday's average rather than silently raising it.
  const history: Array<{ date: string; revenue: number }> = [];
  for (let d = histStart; d <= histEnd; d = addDays(d, 1)) history.push({ date: d, revenue: series.get(d) ?? 0 });

  const { data: hols } = await hrSupabaseAdmin
    .from("hr_public_holidays")
    .select("date, name")
    .gte("date", histStart)
    .lte("date", weekDates[6]);
  const holidays = ((hols ?? []) as Array<{ date: string; name: string }>).map((h) => ({ date: h.date, name: h.name }));

  return buildWeekForecast({ weekDates, history, holidays });
}

export async function forecastWeekRevenue(
  outlet: { id: string; loyaltyOutletId: string | null },
  weekStart: string,
): Promise<number> {
  return (await forecastWeek(outlet, weekStart)).weekly;
}

// Actual revenue for a completed week — same sources, actual dates.
export async function actualWeekRevenue(
  outlet: { id: string; loyaltyOutletId: string | null },
  weekStart: string,
): Promise<number> {
  return revenueBetween(outlet, weekStart, addDays(weekStart, 6));
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Revenue across all capture systems for a MYT date range (inclusive):
// in-house POS (`pos_orders`, GrabFood included) + pickup app (`orders`) +
// StoreHub (`storehub_sales` — retired 2026-06-17, contributes zero after,
// but keeps trailing windows honest while the cutover is inside them).
async function revenueBetween(
  outlet: { id: string; loyaltyOutletId: string | null },
  fromDate: string,
  toDate: string,
): Promise<number> {
  const lid = outlet.loyaltyOutletId ?? "";
  const storeId = PICKUP_STORE_BY_LOYALTY[lid] ?? "";
  const rows = await prisma.$queryRaw<Array<{ revenue: number | null }>>`
    SELECT (
      COALESCE((
        SELECT sum(total) / 100.0 FROM pos_orders
        WHERE outlet_id = ${lid}
          AND status = 'completed' AND refund_of_order_id IS NULL
          AND (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
              BETWEEN ${fromDate}::date AND ${toDate}::date
      ), 0)
      +
      COALESCE((
        SELECT sum(total) / 100.0 FROM orders
        WHERE store_id = ${storeId}
          AND status IN ('completed','ready','collected','paid','preparing')
          AND (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
              BETWEEN ${fromDate}::date AND ${toDate}::date
      ), 0)
      +
      COALESCE((
        SELECT sum(total) FROM storehub_sales
        WHERE outlet_id = ${outlet.id}
          AND transaction_type = 'Sale' AND COALESCE(is_cancelled, false) = false
          AND (transaction_time AT TIME ZONE 'Asia/Kuala_Lumpur')::date
              BETWEEN ${fromDate}::date AND ${toDate}::date
      ), 0)
    )::float AS revenue
  `;
  return rows[0]?.revenue ?? 0;
}

// Per-MYT-date revenue across the same sources, for the forecaster's per-weekday
// history. One grouped query; days with no sales are simply absent (the caller
// fills them with 0).
export async function dailyRevenueSeries(
  outlet: { id: string; loyaltyOutletId: string | null },
  fromDate: string,
  toDate: string,
): Promise<Map<string, number>> {
  const lid = outlet.loyaltyOutletId ?? "";
  const storeId = PICKUP_STORE_BY_LOYALTY[lid] ?? "";
  const rows = await prisma.$queryRaw<Array<{ d: string; revenue: number | null }>>`
    SELECT d::text AS d, sum(rev)::float AS revenue FROM (
      SELECT (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS d, sum(total) / 100.0 AS rev
        FROM pos_orders
        WHERE outlet_id = ${lid} AND status = 'completed' AND refund_of_order_id IS NULL
          AND (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date BETWEEN ${fromDate}::date AND ${toDate}::date
        GROUP BY 1
      UNION ALL
      SELECT (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date, sum(total) / 100.0
        FROM orders
        WHERE store_id = ${storeId} AND status IN ('completed','ready','collected','paid','preparing')
          AND (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date BETWEEN ${fromDate}::date AND ${toDate}::date
        GROUP BY 1
      UNION ALL
      SELECT (transaction_time AT TIME ZONE 'Asia/Kuala_Lumpur')::date, sum(total)
        FROM storehub_sales
        WHERE outlet_id = ${outlet.id} AND transaction_type = 'Sale' AND COALESCE(is_cancelled, false) = false
          AND (transaction_time AT TIME ZONE 'Asia/Kuala_Lumpur')::date BETWEEN ${fromDate}::date AND ${toDate}::date
        GROUP BY 1
    ) s GROUP BY d
  `;
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.d, Number(r.revenue) || 0);
  return out;
}

// Price one outlet-week's roster and gate it. Reads the schedule's shifts
// (draft or published) + HR profiles, forecasts revenue, applies the budget.
export async function gateSchedule(outletId: string, weekStart: string): Promise<LabourGateResult> {
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, code: true, name: true, loyaltyOutletId: true, daysOpen: true },
  });
  if (!outlet) throw new Error(`Outlet ${outletId} not found`);

  const budget = OUTLET_BUDGETS[outlet.code ?? ""] ?? DEFAULT_BUDGET;

  const { data: schedule } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id")
    .eq("outlet_id", outletId)
    .eq("week_start", weekStart)
    .maybeSingle();

  let rows: ShiftCostRow[] = [];
  // Primary outlet per rostered user — a rostered FT whose primary is elsewhere
  // is a BORROWED head, charged here pro-rata by hours (rotation-cost rule).
  const primaryOutletOf = new Map<string, string | null>();
  if (schedule) {
    const { data: shifts } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .select("user_id, shift_date, start_time, end_time")
      .eq("schedule_id", schedule.id);

    const userIds = [...new Set((shifts ?? []).map((s) => s.user_id))];
    const [{ data: profiles }, users] = await Promise.all([
      hrSupabaseAdmin
        .from("hr_employee_profiles")
        .select("user_id, position, employment_type, hourly_rate, basic_salary, epf_employer_rate")
        .in("user_id", userIds.length ? userIds : ["-"]),
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, outletId: true } }),
    ]);
    for (const u of users) primaryOutletOf.set(u.id, u.outletId);
    type ProfileRow = {
      user_id: string;
      position: string | null;
      employment_type: string | null;
      hourly_rate: number | null;
      basic_salary: number | null;
      epf_employer_rate: number | null;
    };
    const profileMap = new Map<string, ProfileRow>((profiles ?? []).map((p: ProfileRow) => [p.user_id, p]));
    const nameMap = new Map(users.map((u) => [u.id, u.name]));

    rows = (shifts ?? []).map((s) => {
      const p = profileMap.get(s.user_id);
      return {
        user_id: s.user_id,
        shift_date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        userName: nameMap.get(s.user_id) ?? s.user_id.slice(0, 8),
        position: p?.position ?? null,
        employment_type: p?.employment_type ?? null,
        hourly_rate: p?.hourly_rate == null ? null : Number(p.hourly_rate),
        basic_salary: p?.basic_salary == null ? null : Number(p.basic_salary),
        epf_employer_rate: p?.epf_employer_rate == null ? null : Number(p.epf_employer_rate),
      };
    });
  }

  // costRoster still validates the roster (blockers, quota warnings,
  // hours), but the COST side splits: FT salaries are sunk, so every
  // schedulable FT assigned to this outlet is charged their full weekly
  // share whether the roster uses them for 30h or 45h. Only PT hours move
  // with the roster — the owner's rule: PT is the spend that moves %.
  const { hours, blockers, warnings } = costRoster(rows);
  const { data: ftProfiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, position, employment_type, basic_salary, epf_employer_rate, schedule_required")
    .is("end_date", null)
    .in("employment_type", ["full_time", "contract"]);
  type FtRow = {
    user_id: string; position: string | null; employment_type: string;
    basic_salary: number | null; epf_employer_rate: number | null; schedule_required: boolean | null;
  };
  const ftCandidates = ((ftProfiles ?? []) as FtRow[]).filter(
    (p) =>
      p.schedule_required !== false &&
      !["manager", "area manager", "head of department", "barista lead"].includes(
        (p.position ?? "").trim().toLowerCase(),
      ),
  );
  const outletFtUsers = ftCandidates.length
    ? await prisma.user.findMany({
        where: { id: { in: ftCandidates.map((p) => p.user_id) }, status: "ACTIVE", outletId },
        select: { id: true },
      })
    : [];
  const outletFtIds = new Set(outletFtUsers.map((u) => u.id));
  const shareOf = new Map(
    ftCandidates.map((p) => [
      p.user_id,
      weeklySalaryShare(Number(p.basic_salary) || 0, p.epf_employer_rate == null ? null : Number(p.epf_employer_rate)),
    ]),
  );

  // Rotation-cost split (owner rule): cost follows the HOURS.
  //  • primary FT here: full weekly share MINUS the pro-rata slice for hours
  //    they work at OTHER outlets this week (charged there instead);
  //  • borrowed FT (primary elsewhere, rostered here): pro-rata charge for the
  //    hours they work HERE.
  // Manager / Area Manager / rover cost is HQ overhead — RM0 to any outlet.
  const { data: lentShifts } = outletFtIds.size
    ? await hrSupabaseAdmin
        .from("hr_schedule_shifts")
        .select("user_id, shift_date, start_time, end_time, break_minutes, hr_schedules!inner(outlet_id, week_start)")
        .in("user_id", [...outletFtIds])
        .eq("hr_schedules.week_start", weekStart)
        .neq("hr_schedules.outlet_id", outletId)
        .neq("start_time", "00:00")
    : { data: [] as unknown[] };
  const hoursElsewhere = new Map<string, number>();
  const daysElsewhere = new Map<string, Set<string>>();
  for (const s of ((lentShifts ?? []) as unknown as Array<{ user_id: string; shift_date: string; start_time: string; end_time: string; break_minutes: number | null }>)) {
    const h = shiftHours(s.start_time, s.end_time) - (s.break_minutes ?? 0) / 60;
    if (h > 0) hoursElsewhere.set(s.user_id, (hoursElsewhere.get(s.user_id) ?? 0) + h);
    (daysElsewhere.get(s.user_id) ?? daysElsewhere.set(s.user_id, new Set()).get(s.user_id)!).add(s.shift_date);
  }
  const primaryFtWeekly = [...outletFtIds].reduce((sum, uid) => {
    const share = shareOf.get(uid) ?? 0;
    return sum + share - lentFtCredit(share, hoursElsewhere.get(uid) ?? 0);
  }, 0);
  const borrowedHours = new Map<string, number>();
  for (const r of rows) {
    if (r.employment_type !== "full_time" && r.employment_type !== "contract") continue;
    if (!shareOf.has(r.user_id)) continue; // rovers/managers filtered out of ftCandidates
    if (outletFtIds.has(r.user_id)) continue; // primary here, not borrowed
    if ((primaryOutletOf.get(r.user_id) ?? outletId) === outletId) continue;
    const h = shiftHours(r.start_time, r.end_time);
    if (h > 0) borrowedHours.set(r.user_id, (borrowedHours.get(r.user_id) ?? 0) + h);
  }
  const borrowedFtWeekly = [...borrowedHours.entries()].reduce(
    (sum, [uid, h]) => sum + borrowedFtCharge(shareOf.get(uid) ?? 0, h),
    0,
  );
  // Rover lead (Barista Lead) is a WORKING rover: their cost follows their hours
  // here, same pro-rata rule. Managers / Area Managers / HoD stay RM0 (HQ).
  const roverLeadHours = new Map<string, { hours: number; share: number }>();
  for (const r of rows) {
    if ((r.position ?? "").trim().toLowerCase() !== "barista lead") continue;
    const h = shiftHours(r.start_time, r.end_time);
    if (h <= 0) continue;
    const cur = roverLeadHours.get(r.user_id) ?? {
      hours: 0,
      share: weeklySalaryShare(Number(r.basic_salary) || 0, r.epf_employer_rate == null ? null : Number(r.epf_employer_rate)),
    };
    cur.hours += h;
    roverLeadHours.set(r.user_id, cur);
  }
  const roverLeadWeekly = [...roverLeadHours.values()].reduce((sum, v) => sum + borrowedFtCharge(v.share, v.hours), 0);
  const ptCost = rows.reduce((sum, r) => {
    if (r.employment_type !== "part_time" && r.employment_type !== "intern") return sum;
    if (!r.hourly_rate || r.hourly_rate <= 0) return sum;
    return sum + shiftHours(r.start_time, r.end_time) * r.hourly_rate;
  }, 0);
  const ftFixedCost = Math.round(primaryFtWeekly + borrowedFtWeekly + roverLeadWeekly);
  const rosterCost = Math.round(ftFixedCost + ptCost);

  // Idle sunk-FT capacity: a primary FT is paid their full week regardless of the
  // roster, so an under-scheduled FT is wasted cost, not a saving — benching them
  // never lowers ftFixedCost. Flag any primary FT scheduled well below their
  // 6-day capacity (net of approved leave) so "cut FT hours to hit the %" is seen
  // for the false economy it is.
  const openDayCount = outlet.daysOpen?.length ? new Set(outlet.daysOpen.map((d) => d % 7)).size : 7;
  const expectedDays = Math.min(6, openDayCount);
  if (outletFtIds.size > 0) {
    const ftDays = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!outletFtIds.has(r.user_id) || shiftHours(r.start_time, r.end_time) <= 0) continue;
      (ftDays.get(r.user_id) ?? ftDays.set(r.user_id, new Set()).get(r.user_id)!).add(r.shift_date);
    }
    const weekEnd = addDays(weekStart, 6);
    const [{ data: ftLeaveRows }, ftUsers] = await Promise.all([
      hrSupabaseAdmin
        .from("hr_leave_requests")
        .select("user_id, start_date, end_date")
        .in("status", ["approved", "ai_approved"])
        .in("user_id", [...outletFtIds])
        .lte("start_date", weekEnd)
        .gte("end_date", weekStart),
      prisma.user.findMany({ where: { id: { in: [...outletFtIds] } }, select: { id: true, name: true } }),
    ]);
    const leaveDays = new Map<string, number>();
    for (const l of (ftLeaveRows ?? []) as Array<{ user_id: string; start_date: string; end_date: string }>) {
      let n = 0;
      for (let i = 0; i < 7; i++) { const d = addDays(weekStart, i); if (d >= l.start_date && d <= l.end_date) n++; }
      if (n > 0) leaveDays.set(l.user_id, Math.max(leaveDays.get(l.user_id) ?? 0, n));
    }
    const ftName = new Map(ftUsers.map((u) => [u.id, u.name]));
    for (const uid of outletFtIds) {
      // Days lent to other outlets count as worked — a fully-lent FT isn't idle.
      const worked = (ftDays.get(uid)?.size ?? 0) + (daysElsewhere.get(uid)?.size ?? 0);
      const target = Math.max(0, expectedDays - (leaveDays.get(uid) ?? 0));
      const idle = target - worked;
      if (idle >= 2) {
        warnings.push(
          `Idle FT capacity: ${ftName.get(uid) ?? uid.slice(0, 8)} scheduled ${worked}/${target} days (incl. days lent to other outlets) — ${idle} paid days unused. FT salary is fixed; benching doesn't cut cost, only wastes coverage.`,
        );
      }
    }
  }

  const weekForecast = await forecastWeek(outlet, weekStart);
  const forecastRevenue = Math.round(weekForecast.weekly);
  const pct = forecastRevenue > 0 ? rosterCost / forecastRevenue : null;
  const dayForecast = new Map(weekForecast.byDate.map((d) => [d.date, d]));
  // Per-day rostered hours (net of breaks) for the indicative daily %.
  const dayHours = new Map<string, number>();
  for (const r of rows) {
    const h = shiftHours(r.start_time, r.end_time);
    if (h > 0) dayHours.set(r.shift_date, (dayHours.get(r.shift_date) ?? 0) + h);
  }

  // Per-day coverage from THE demand model (lib/hr/demand.ts) — the same
  // items-per-hour × serve-calibrated station rates AI Fill staffs to, so the
  // grid's "short Xh" is exactly the man-hours the generator would add. (This
  // replaces the old hourly-revenue ÷ RM69 heuristic, which disagreed with the
  // roster model and made the day gaps unusable for PT allocation.)
  const weekDemand = await computeWeekDemand(outlet, weekStart);
  const need = weekDemand.demand;
  const coverage: LabourGateResult["coverage"] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const dw = new Date(`${date}T00:00:00Z`).getUTCDay();
    let neededHours = 0;
    let scheduledHours = 0;
    let shortHours = 0;
    for (let h = 0; h < 24; h++) {
      const n = need.get(`${dw}:${h}`) ?? 0;
      if (n === 0) continue;
      const have = rows.filter(
        (r) => r.shift_date === date &&
          Number(r.start_time.slice(0, 2)) <= h && Number(r.end_time.slice(0, 2)) > h,
      ).length;
      neededHours += n;
      scheduledHours += Math.min(have, n);
      if (n > have) shortHours += n - have;
    }
    // Per-day forecast + daily labour %: the day's PRO-RATA SHARE of the week's
    // ACTUAL roster cost (by hours) ÷ the day's forecast. Day costs sum exactly
    // to rosterCost, so the forecast-weighted average of the daily %s equals the
    // weekly chip — the two scales agree. (The old version priced days at a flat
    // RM12/h planning rate while the week used real salaries ≈ RM10/h effective,
    // so every daily % read ~20% too high vs the total.)
    const df = dayForecast.get(date);
    const fc = df ? Math.round(df.forecast) : undefined;
    const totalWeekHours = [...dayHours.values()].reduce((s, v) => s + v, 0);
    const dayCost = totalWeekHours > 0 ? ((dayHours.get(date) ?? 0) / totalWeekHours) * rosterCost : 0;
    const dayPct = fc && fc > 0 && dayCost > 0 ? dayCost / fc : null;
    coverage.push({
      date, neededHours, scheduledHours, shortHours,
      items: Math.round(weekDemand.itemsByDow.get(dw) ?? 0),
      forecast: fc, pct: dayPct, isWeekend: df?.isWeekend, isHoliday: df?.isHoliday, holidayName: df?.holidayName,
    });
  }

  return {
    outletId: outlet.id,
    outletCode: outlet.code ?? "",
    outletName: outlet.name,
    weekStart,
    forecastRevenue,
    rosterCost,
    ftFixedCost,
    ptCost: Math.round(ptCost),
    rosterHours: Math.round(hours),
    pct,
    targetPct: budget.target,
    ceilingPct: budget.ceiling,
    verdict: verdictFor(pct, budget),
    blockers,
    warnings,
    coverage,
  };
}
