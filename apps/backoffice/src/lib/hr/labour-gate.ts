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
  ROVER_SHARE_WEEKLY,
  type LabourGateResult,
  type ShiftCostRow,
} from "@/lib/hr/labour-gate-lib";

export * from "@/lib/hr/labour-gate-lib";

// pickup-app `orders.store_id` per loyalty outlet id (`pos_orders.outlet_id`).
const PICKUP_STORE_BY_LOYALTY: Record<string, string> = {
  "outlet-con": "conezion",
  "outlet-sa": "shah-alam",
  "outlet-tam": "tamarind",
  "outlet-nilai": "nilai",
};

// Forecast the week's revenue as (last 28 days of actual revenue) / 4 —
// arithmetically identical to summing trailing-4-week same-weekday averages
// when history is complete, and one query instead of seven. Sources are the
// in-house POS (`pos_orders`, GrabFood included) + the pickup app (`orders`);
// StoreHub retired 2026-06-17, so post-cutover weeks are fully covered.
export async function forecastWeekRevenue(
  outlet: { id: string; loyaltyOutletId: string | null },
  weekStart: string,
): Promise<number> {
  const monthRevenue = await revenueBetween(outlet, addDays(weekStart, -28), addDays(weekStart, -1));
  return monthRevenue / 4;
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

// Price one outlet-week's roster and gate it. Reads the schedule's shifts
// (draft or published) + HR profiles, forecasts revenue, applies the budget.
export async function gateSchedule(outletId: string, weekStart: string): Promise<LabourGateResult> {
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, code: true, name: true, loyaltyOutletId: true },
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
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    ]);
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
  const ftWeekly = ftCandidates
    .filter((p) => outletFtIds.has(p.user_id))
    .reduce((sum, p) => sum + weeklySalaryShare(Number(p.basic_salary) || 0, p.epf_employer_rate == null ? null : Number(p.epf_employer_rate)), 0);
  const ptCost = rows.reduce((sum, r) => {
    if (r.employment_type !== "part_time" && r.employment_type !== "intern") return sum;
    if (!r.hourly_rate || r.hourly_rate <= 0) return sum;
    return sum + shiftHours(r.start_time, r.end_time) * r.hourly_rate;
  }, 0);
  const rosterCost = Math.round(ftWeekly + ptCost + ROVER_SHARE_WEEKLY);
  const forecastRevenue = Math.round(await forecastWeekRevenue(outlet, weekStart));
  const pct = forecastRevenue > 0 ? rosterCost / forecastRevenue : null;

  // Per-day coverage: sales-derived staff need (hourly revenue / RM69, the
  // workbook's labour-hour heuristic) vs heads rostered in each hour.
  const hourly = await prisma.$queryRaw<Array<{ dw: number; hr: number; rev: number }>>`
    SELECT EXTRACT(DOW FROM (created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS dw,
           EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS hr,
           (sum(total) / 100.0 / 4)::float AS rev
    FROM pos_orders
    WHERE outlet_id = ${outlet.loyaltyOutletId ?? ""}
      AND status = 'completed' AND refund_of_order_id IS NULL
      AND (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
          BETWEEN ${weekStart}::date - 28 AND ${weekStart}::date - 1
    GROUP BY 1, 2
  `;
  const need = new Map<string, number>();
  for (const h of hourly) need.set(`${h.dw}:${h.hr}`, Math.ceil(h.rev / 69));
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
    coverage.push({ date, neededHours, scheduledHours, shortHours });
  }

  return {
    outletId: outlet.id,
    outletCode: outlet.code ?? "",
    outletName: outlet.name,
    weekStart,
    forecastRevenue,
    rosterCost,
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
