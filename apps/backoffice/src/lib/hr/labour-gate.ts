// IO half of the labour-cost gate: revenue forecasting + schedule pricing.
// Pure costing/verdict logic lives in labour-gate-lib.ts (unit-tested there).

import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import {
  costRoster,
  verdictFor,
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
  loyaltyOutletId: string | null,
  weekStart: string,
): Promise<number> {
  if (!loyaltyOutletId) return 0;
  const storeId = PICKUP_STORE_BY_LOYALTY[loyaltyOutletId] ?? "";
  const rows = await prisma.$queryRaw<Array<{ revenue: number | null }>>`
    SELECT (
      COALESCE((
        SELECT sum(total) / 100.0 FROM pos_orders
        WHERE outlet_id = ${loyaltyOutletId}
          AND status = 'completed' AND refund_of_order_id IS NULL
          AND (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
              BETWEEN ${weekStart}::date - 28 AND ${weekStart}::date - 1
      ), 0)
      +
      COALESCE((
        SELECT sum(total) / 100.0 FROM orders
        WHERE store_id = ${storeId}
          AND status IN ('completed','ready','collected','paid')
          AND (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
              BETWEEN ${weekStart}::date - 28 AND ${weekStart}::date - 1
      ), 0)
    )::float AS revenue
  `;
  const monthRevenue = rows[0]?.revenue ?? 0;
  return monthRevenue / 4;
}

// Actual revenue for a completed week — same sources, actual dates.
export async function actualWeekRevenue(
  loyaltyOutletId: string | null,
  weekStart: string,
): Promise<number> {
  if (!loyaltyOutletId) return 0;
  const storeId = PICKUP_STORE_BY_LOYALTY[loyaltyOutletId] ?? "";
  const rows = await prisma.$queryRaw<Array<{ revenue: number | null }>>`
    SELECT (
      COALESCE((
        SELECT sum(total) / 100.0 FROM pos_orders
        WHERE outlet_id = ${loyaltyOutletId}
          AND status = 'completed' AND refund_of_order_id IS NULL
          AND (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
              BETWEEN ${weekStart}::date AND ${weekStart}::date + 6
      ), 0)
      +
      COALESCE((
        SELECT sum(total) / 100.0 FROM orders
        WHERE store_id = ${storeId}
          AND status IN ('completed','ready','collected','paid')
          AND (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
              BETWEEN ${weekStart}::date AND ${weekStart}::date + 6
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

  const { cost, hours, blockers, warnings } = costRoster(rows);
  const rosterCost = Math.round(cost + ROVER_SHARE_WEEKLY);
  const forecastRevenue = Math.round(await forecastWeekRevenue(outlet.loyaltyOutletId, weekStart));
  const pct = forecastRevenue > 0 ? rosterCost / forecastRevenue : null;

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
  };
}
