// THE demand model — the single source of "how many heads does each hour
// need". Consumed by BOTH the AI Fill generator (roster sizing) and the labour
// gate / Schedules grid (per-day shortfall shown to managers for PT
// allocation), so what the grid says is short is exactly what the generator
// would staff to. Extracted from the generator 2026-07-17.
//
// Model: trailing 28 days of items sold per (day-of-week, hour) — POS orders
// (GrabFood included) PLUS the pickup app's `orders` (a separate table that
// never lands in pos_orders: ~23% of Shah Alam volume with a HEAVIER kitchen
// mix, invisible to staffing until 2026-07-17) — split by station — barista
// (drinks + counter pastries + uncategorised) vs kitchen (cooked food) —
// divided by MEASURED station capacity (see lib/hr/serve-time.ts: p80 of
// items per clocked-in head over trailing hours whose median serve MET the
// 10/15-minute standard, planned at 85% headroom; base 8/hr barista · 6/hr
// kitchen until an outlet has proven a sample), floored at the service
// minimum.

import { prisma } from "@/lib/prisma";
import {
  planningRate,
  describeCapacity,
  BARISTA_SERVE_TARGET_MIN,
  KITCHEN_SERVE_TARGET_MIN,
  CAPACITY_MIN_ITEMS,
} from "./serve-time";

// BASE station throughput (items one head makes + serves per hour) — starting
// points only; every computation re-calibrates from measured serve times.
export const BARISTA_ITEMS_PER_HR = 8;
export const KITCHEN_ITEMS_PER_HR = 6;
// Cooked-food menu categories → kitchen station; everything else (drinks +
// cakes/cookies/croissants + uncategorised) is barista/counter.
export const KITCHEN_CATEGORIES = ["Roti Bakar", "Nasi Lemak", "Pasta", "Sandwiches", "Fries", "Noodle"];
// Minimum concurrent heads while trading (workbook service floor).
export const SERVICE_FLOOR = 3;

// pickup-app `orders.store_id` per loyalty outlet id (`pos_orders.outlet_id`).
// The pickup app is a separate order stream — same staff make those items.
export const PICKUP_STORE_BY_LOYALTY: Record<string, string> = {
  "outlet-con": "conezion",
  "outlet-sa": "shah-alam",
  "outlet-tam": "tamarind",
  "outlet-nilai": "nilai",
};
// Pickup statuses that represent real, made orders (mirrors the revenue query
// in labour-gate.ts so workload and money see the same stream).
const PICKUP_STATUSES = ["completed", "ready", "collected", "paid", "preparing"];

export type WeekDemand = {
  demand: Map<string, number>; // "dw:hr" → heads needed (station-split, floored)
  // Per-station heads per hour (raw ceil(items ÷ rate), NO floor — the service
  // floor is a total-store concept the consumer applies). These drive
  // per-station shift allocation: kitchen crew are placed on the KITCHEN item
  // curve, baristas on the barista curve (owner rule 2026-07-17).
  kitHeadsByHour: Map<string, number>; // "dw:hr" → kitchen heads
  barHeadsByHour: Map<string, number>; // "dw:hr" → barista/counter heads
  itemsByDow: Map<number, number>; // dw → avg items/day
  barItemsByDow: Map<number, number>; // dw → avg barista/counter items/day (FOH)
  kitItemsByDow: Map<number, number>; // dw → avg cooked items/day (BOH)
  peakByDow: Map<number, { heads: number; hr: number; bar: number; kit: number }>;
  baristaRate: number;
  kitchenRate: number;
  calibrationNote: string; // human-readable line for ai_notes / tooltips
};

export async function computeWeekDemand(
  outlet: { id?: string; loyaltyOutletId: string | null },
  weekStart: string,
): Promise<WeekDemand> {
  const storeId = PICKUP_STORE_BY_LOYALTY[outlet.loyaltyOutletId ?? ""] ?? "";
  // History window: trailing 28 days, but never past YESTERDAY (MYT). Rosters
  // are generated mid-week for the NEXT week, so `weekStart - 1` includes days
  // that haven't happened (and today, which is partial). A hard ÷4 then diluted
  // exactly those weekdays — Sunday read 25% low when generated on a Friday,
  // which is why the weekend kept looking cheaper to the model than in reality
  // (owner catch 2026-07-18). Each weekday now divides by the number of
  // COMPLETE occurrences actually inside the window.
  const addDays = (d: string, n: number) => {
    const t = new Date(d + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  const mytYesterday = new Date(Date.now() + 8 * 3600_000 - 24 * 3600_000).toISOString().slice(0, 10);
  const histStart = addDays(weekStart, -28);
  const histEnd = addDays(weekStart, -1) < mytYesterday ? addDays(weekStart, -1) : mytYesterday;
  const dowCount = new Map<number, number>();
  for (let d = histStart; d <= histEnd; d = addDays(d, 1)) {
    const dw = new Date(d + "T00:00:00Z").getUTCDay();
    dowCount.set(dw, (dowCount.get(dw) ?? 0) + 1);
  }
  const perDow = (dw: number) => Math.max(1, dowCount.get(dw) ?? 0);

  const hourly = await prisma.$queryRaw<Array<{ dw: number; hr: number; barista: number; kitchen: number }>>`
    SELECT dw, hr, sum(kitchen)::float AS kitchen, sum(barista)::float AS barista FROM (
      SELECT EXTRACT(DOW FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS dw,
             EXTRACT(HOUR FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS hr,
             sum(i.quantity) FILTER (WHERE m.category = ANY(${KITCHEN_CATEGORIES}))::float AS kitchen,
             sum(i.quantity) FILTER (WHERE m.category IS NULL OR NOT (m.category = ANY(${KITCHEN_CATEGORIES})))::float AS barista
      FROM pos_order_items i
      JOIN pos_orders o ON o.id = i.order_id
      LEFT JOIN "Menu" m ON m."storehubId" = i.product_id
      WHERE o.outlet_id = ${outlet.loyaltyOutletId ?? ""}
        AND o.status = 'completed' AND o.refund_of_order_id IS NULL
        AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
            BETWEEN ${histStart}::date AND ${histEnd}::date
      GROUP BY 1, 2
      UNION ALL
      SELECT EXTRACT(DOW FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int,
             EXTRACT(HOUR FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int,
             sum(i.quantity) FILTER (WHERE m.category = ANY(${KITCHEN_CATEGORIES}))::float,
             sum(i.quantity) FILTER (WHERE m.category IS NULL OR NOT (m.category = ANY(${KITCHEN_CATEGORIES})))::float
      FROM order_items i
      JOIN orders o ON o.id = i.order_id
      LEFT JOIN "Menu" m ON m."storehubId" = i.product_id
      WHERE o.store_id = ${storeId}
        AND o.status = ANY(${PICKUP_STATUSES})
        AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
            BETWEEN ${histStart}::date AND ${histEnd}::date
      GROUP BY 1, 2
    ) u
    GROUP BY 1, 2
  `;

  // Measured station capacity (the "enough manpower" feedback loop, v2 —
  // owner correction 2026-07-17: staff work OVERLAPPING, so the 10/15-minute
  // standards are order-latency promises, not per-item labour costs). For each
  // trailing (day, hour): items handled ÷ heads actually CLOCKED IN per
  // station; keep only hours with real volume where the station's median serve
  // met its target; p80 of those = demonstrated capacity. Plan at 85% of it.
  const capRows = outlet.id
    ? await prisma.$queryRaw<Array<{ bar_n: number; bar_p80: number | null; kit_n: number; kit_p80: number | null }>>`
    WITH att AS (
      SELECT (a.clock_in AT TIME ZONE 'Asia/Kuala_Lumpur') AS ci,
             (a.clock_out AT TIME ZONE 'Asia/Kuala_Lumpur') AS co,
             CASE WHEN lower(COALESCE(p.position, '')) ~ 'kitchen|chef|boh' THEN 'kitchen' ELSE 'barista' END AS station
      FROM hr_attendance_logs a
      LEFT JOIN hr_employee_profiles p ON p.user_id = a.user_id
      WHERE a.outlet_id = ${outlet.id} AND a.clock_out IS NOT NULL
        AND (a.clock_in AT TIME ZONE 'Asia/Kuala_Lumpur')::date
            BETWEEN ${weekStart}::date - 28 AND ${weekStart}::date - 1
    ), slots AS (
      SELECT d::date AS day, h AS hr
      FROM generate_series(${weekStart}::date - 28, ${weekStart}::date - 1, interval '1 day') d,
           generate_series(6, 23) h
    ), heads AS (
      SELECT s.day, s.hr,
        count(*) FILTER (WHERE a.station = 'barista' AND a.ci <= (s.day + (s.hr || ':30')::time) AND a.co >= (s.day + (s.hr || ':30')::time)) AS bar_heads,
        count(*) FILTER (WHERE a.station = 'kitchen' AND a.ci <= (s.day + (s.hr || ':30')::time) AND a.co >= (s.day + (s.hr || ':30')::time)) AS kit_heads
      FROM slots s LEFT JOIN att a ON true
      GROUP BY 1, 2
    ), itm AS (
      SELECT day, hr, sum(bar) AS bar_items, sum(kit) AS kit_items FROM (
        SELECT (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS day,
               EXTRACT(HOUR FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS hr,
               sum(i.quantity) FILTER (WHERE m.category IS NULL OR NOT (m.category = ANY(${KITCHEN_CATEGORIES})))::float AS bar,
               sum(i.quantity) FILTER (WHERE m.category = ANY(${KITCHEN_CATEGORIES}))::float AS kit
        FROM pos_order_items i JOIN pos_orders o ON o.id = i.order_id
        LEFT JOIN "Menu" m ON m."storehubId" = i.product_id
        WHERE o.outlet_id = ${outlet.loyaltyOutletId ?? ""} AND o.status = 'completed' AND o.refund_of_order_id IS NULL
          AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date BETWEEN ${weekStart}::date - 28 AND ${weekStart}::date - 1
        GROUP BY 1, 2
        UNION ALL
        SELECT (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date,
               EXTRACT(HOUR FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int,
               sum(i.quantity) FILTER (WHERE m.category IS NULL OR NOT (m.category = ANY(${KITCHEN_CATEGORIES})))::float,
               sum(i.quantity) FILTER (WHERE m.category = ANY(${KITCHEN_CATEGORIES}))::float
        FROM order_items i JOIN orders o ON o.id = i.order_id
        LEFT JOIN "Menu" m ON m."storehubId" = i.product_id
        WHERE o.store_id = ${storeId} AND o.status = ANY(${PICKUP_STATUSES})
          AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date BETWEEN ${weekStart}::date - 28 AND ${weekStart}::date - 1
        GROUP BY 1, 2
      ) u GROUP BY 1, 2
    ), srv AS (
      SELECT (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS day,
             EXTRACT(HOUR FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS hr,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (COALESCE(o.served_at, o.ready_at) - o.created_at)) / 60)
               FILTER (WHERE NOT EXISTS (SELECT 1 FROM pos_order_items i JOIN "Menu" m ON m."storehubId" = i.product_id
                                         WHERE i.order_id = o.id AND m.category = ANY(${KITCHEN_CATEGORIES}))) AS bar_p50,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (COALESCE(o.served_at, o.ready_at) - o.created_at)) / 60)
               FILTER (WHERE EXISTS (SELECT 1 FROM pos_order_items i JOIN "Menu" m ON m."storehubId" = i.product_id
                                     WHERE i.order_id = o.id AND m.category = ANY(${KITCHEN_CATEGORIES}))) AS kit_p50
      FROM pos_orders o
      WHERE o.outlet_id = ${outlet.loyaltyOutletId ?? ""} AND o.status = 'completed' AND o.refund_of_order_id IS NULL
        AND COALESCE(o.served_at, o.ready_at) > o.created_at
        AND COALESCE(o.served_at, o.ready_at) < o.created_at + interval '2 hours'
        AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date BETWEEN ${weekStart}::date - 28 AND ${weekStart}::date - 1
      GROUP BY 1, 2
    )
    SELECT
      count(*) FILTER (WHERE h.bar_heads > 0 AND i.bar_items >= ${CAPACITY_MIN_ITEMS.barista} AND s.bar_p50 <= ${BARISTA_SERVE_TARGET_MIN})::int AS bar_n,
      (percentile_cont(0.8) WITHIN GROUP (ORDER BY i.bar_items / h.bar_heads)
        FILTER (WHERE h.bar_heads > 0 AND i.bar_items >= ${CAPACITY_MIN_ITEMS.barista} AND s.bar_p50 <= ${BARISTA_SERVE_TARGET_MIN}))::float AS bar_p80,
      count(*) FILTER (WHERE h.kit_heads > 0 AND i.kit_items >= ${CAPACITY_MIN_ITEMS.kitchen} AND s.kit_p50 <= ${KITCHEN_SERVE_TARGET_MIN})::int AS kit_n,
      (percentile_cont(0.8) WITHIN GROUP (ORDER BY i.kit_items / h.kit_heads)
        FILTER (WHERE h.kit_heads > 0 AND i.kit_items >= ${CAPACITY_MIN_ITEMS.kitchen} AND s.kit_p50 <= ${KITCHEN_SERVE_TARGET_MIN}))::float AS kit_p80
    FROM heads h
    JOIN itm i ON i.day = h.day AND i.hr = h.hr
    LEFT JOIN srv s ON s.day = h.day AND s.hr = h.hr
  `
    : [];
  const cap = capRows[0];
  const barPlan = planningRate({
    baseRate: BARISTA_ITEMS_PER_HR,
    measuredP80: cap?.bar_p80 ?? null,
    sampleHours: cap?.bar_n ?? 0,
  });
  const kitPlan = planningRate({
    baseRate: KITCHEN_ITEMS_PER_HR,
    measuredP80: cap?.kit_p80 ?? null,
    sampleHours: cap?.kit_n ?? 0,
  });
  const baristaRate = barPlan.rate;
  const kitchenRate = kitPlan.rate;
  const calibrationNote =
    "Measured capacity (28d, clocked-in heads, on-target hours only): " +
    describeCapacity("barista/pastry", barPlan, BARISTA_SERVE_TARGET_MIN) +
    "; " +
    describeCapacity("kitchen", kitPlan, KITCHEN_SERVE_TARGET_MIN);

  const demand = new Map<string, number>();
  const kitHeadsByHour = new Map<string, number>();
  const barHeadsByHour = new Map<string, number>();
  const itemsByDow = new Map<number, number>();
  const barItemsByDow = new Map<number, number>();
  const kitItemsByDow = new Map<number, number>();
  const peakByDow = new Map<number, { heads: number; hr: number; bar: number; kit: number }>();
  for (const h of hourly) {
    // Raw 28-day sums → per-occurrence averages (divide by how many of this
    // weekday actually sit inside the clamped window — 3 or 4, never a flat 4).
    const bar = (Number(h.barista) || 0) / perDow(h.dw);
    const kit = (Number(h.kitchen) || 0) / perDow(h.dw);
    if (bar + kit <= 0) continue;
    const barHeads = Math.ceil(bar / baristaRate);
    const kitHeads = Math.ceil(kit / kitchenRate);
    const heads = Math.max(SERVICE_FLOOR, barHeads + kitHeads);
    demand.set(`${h.dw}:${h.hr}`, heads);
    kitHeadsByHour.set(`${h.dw}:${h.hr}`, kitHeads);
    barHeadsByHour.set(`${h.dw}:${h.hr}`, barHeads);
    itemsByDow.set(h.dw, (itemsByDow.get(h.dw) ?? 0) + bar + kit);
    barItemsByDow.set(h.dw, (barItemsByDow.get(h.dw) ?? 0) + bar);
    kitItemsByDow.set(h.dw, (kitItemsByDow.get(h.dw) ?? 0) + kit);
    const prev = peakByDow.get(h.dw);
    if (!prev || heads > prev.heads) peakByDow.set(h.dw, { heads, hr: h.hr, bar: barHeads, kit: kitHeads });
  }

  return { demand, kitHeadsByHour, barHeadsByHour, itemsByDow, barItemsByDow, kitItemsByDow, peakByDow, baristaRate, kitchenRate, calibrationNote };
}
