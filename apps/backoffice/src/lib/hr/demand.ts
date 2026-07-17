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
// divided by serve-time-CALIBRATED station rates (see lib/hr/serve-time.ts:
// base 8/hr barista · 6/hr kitchen, adjusted by the measured p90 serve vs the
// 10/15-minute standards), floored at the service minimum.

import { prisma } from "@/lib/prisma";
import {
  calibrateRate,
  describeCalibration,
  BARISTA_SERVE_TARGET_MIN,
  KITCHEN_SERVE_TARGET_MIN,
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
  peakByDow: Map<number, { heads: number; hr: number; bar: number; kit: number }>;
  baristaRate: number;
  kitchenRate: number;
  calibrationNote: string; // human-readable line for ai_notes / tooltips
};

export async function computeWeekDemand(
  outlet: { loyaltyOutletId: string | null },
  weekStart: string,
): Promise<WeekDemand> {
  const storeId = PICKUP_STORE_BY_LOYALTY[outlet.loyaltyOutletId ?? ""] ?? "";
  const hourly = await prisma.$queryRaw<Array<{ dw: number; hr: number; barista: number; kitchen: number }>>`
    SELECT dw, hr, sum(kitchen)::float AS kitchen, sum(barista)::float AS barista FROM (
      SELECT EXTRACT(DOW FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS dw,
             EXTRACT(HOUR FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS hr,
             (sum(i.quantity) FILTER (WHERE m.category = ANY(${KITCHEN_CATEGORIES}))::float / 4) AS kitchen,
             (sum(i.quantity) FILTER (WHERE m.category IS NULL OR NOT (m.category = ANY(${KITCHEN_CATEGORIES})))::float / 4) AS barista
      FROM pos_order_items i
      JOIN pos_orders o ON o.id = i.order_id
      LEFT JOIN "Menu" m ON m."storehubId" = i.product_id
      WHERE o.outlet_id = ${outlet.loyaltyOutletId ?? ""}
        AND o.status = 'completed' AND o.refund_of_order_id IS NULL
        AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
            BETWEEN ${weekStart}::date - 28 AND ${weekStart}::date - 1
      GROUP BY 1, 2
      UNION ALL
      SELECT EXTRACT(DOW FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int,
             EXTRACT(HOUR FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int,
             (sum(i.quantity) FILTER (WHERE m.category = ANY(${KITCHEN_CATEGORIES}))::float / 4),
             (sum(i.quantity) FILTER (WHERE m.category IS NULL OR NOT (m.category = ANY(${KITCHEN_CATEGORIES})))::float / 4)
      FROM order_items i
      JOIN orders o ON o.id = i.order_id
      LEFT JOIN "Menu" m ON m."storehubId" = i.product_id
      WHERE o.store_id = ${storeId}
        AND o.status = ANY(${PICKUP_STATUSES})
        AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
            BETWEEN ${weekStart}::date - 28 AND ${weekStart}::date - 1
      GROUP BY 1, 2
    ) u
    GROUP BY 1, 2
  `;

  // Serve-time self-calibration (the "enough manpower" feedback loop): measure
  // the ACTUAL p90 serve over the same window, split by station — an order with
  // any cooked item is KITCHEN-gated (15-min standard), drinks/pastry-only is a
  // BARISTA order (10-min standard). A breach lowers that station's rate → the
  // demand asks for more heads at the loaded hours. No human judges "enough".
  const serveRows = await prisma.$queryRaw<Array<{ is_kitchen: boolean; n: number; p90: number | null }>>`
    SELECT is_kitchen, count(*)::int AS n,
           (percentile_cont(0.9) WITHIN GROUP (ORDER BY mins))::float AS p90
    FROM (
      SELECT EXISTS (
               SELECT 1 FROM pos_order_items i
               JOIN "Menu" m ON m."storehubId" = i.product_id
               WHERE i.order_id = o.id AND m.category = ANY(${KITCHEN_CATEGORIES})
             ) AS is_kitchen,
             EXTRACT(EPOCH FROM (COALESCE(o.served_at, o.ready_at) - o.created_at)) / 60 AS mins
      FROM pos_orders o
      WHERE o.outlet_id = ${outlet.loyaltyOutletId ?? ""}
        AND o.status = 'completed' AND o.refund_of_order_id IS NULL
        AND COALESCE(o.served_at, o.ready_at) IS NOT NULL
        AND COALESCE(o.served_at, o.ready_at) > o.created_at
        AND COALESCE(o.served_at, o.ready_at) < o.created_at + interval '2 hours'
        AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
            BETWEEN ${weekStart}::date - 28 AND ${weekStart}::date - 1
      UNION ALL
      -- Pickup app: order placed → marked ready is the customer-facing wait,
      -- gated by the same station standard as walk-in orders.
      SELECT EXISTS (
               SELECT 1 FROM order_items i
               JOIN "Menu" m ON m."storehubId" = i.product_id
               WHERE i.order_id = o.id AND m.category = ANY(${KITCHEN_CATEGORIES})
             ),
             EXTRACT(EPOCH FROM (o.ready_at - o.created_at)) / 60
      FROM orders o
      WHERE o.store_id = ${storeId}
        AND o.status = ANY(${PICKUP_STATUSES})
        AND o.ready_at IS NOT NULL
        AND o.ready_at > o.created_at
        AND o.ready_at < o.created_at + interval '2 hours'
        AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
            BETWEEN ${weekStart}::date - 28 AND ${weekStart}::date - 1
    ) s
    GROUP BY 1
  `;
  const serveOf = (kitchen: boolean) => serveRows.find((r) => r.is_kitchen === kitchen);
  const barServe = serveOf(false);
  const kitServe = serveOf(true);
  const barCal = calibrateRate({
    baseRate: BARISTA_ITEMS_PER_HR, p90ServeMin: barServe?.p90 ?? null,
    targetMin: BARISTA_SERVE_TARGET_MIN, sample: barServe?.n ?? 0, floor: 4, cap: 14,
  });
  const kitCal = calibrateRate({
    baseRate: KITCHEN_ITEMS_PER_HR, p90ServeMin: kitServe?.p90 ?? null,
    targetMin: KITCHEN_SERVE_TARGET_MIN, sample: kitServe?.n ?? 0, floor: 3, cap: 8,
  });
  const baristaRate = barCal.rate;
  const kitchenRate = kitCal.rate;
  const calibrationNote =
    "Serve-time calibration (28d): " +
    describeCalibration("barista/pastry", barCal, barServe?.p90 ?? null, BARISTA_SERVE_TARGET_MIN, barServe?.n ?? 0) +
    "; " +
    describeCalibration("kitchen", kitCal, kitServe?.p90 ?? null, KITCHEN_SERVE_TARGET_MIN, kitServe?.n ?? 0);

  const demand = new Map<string, number>();
  const kitHeadsByHour = new Map<string, number>();
  const barHeadsByHour = new Map<string, number>();
  const itemsByDow = new Map<number, number>();
  const peakByDow = new Map<number, { heads: number; hr: number; bar: number; kit: number }>();
  for (const h of hourly) {
    const bar = Number(h.barista) || 0;
    const kit = Number(h.kitchen) || 0;
    if (bar + kit <= 0) continue;
    const barHeads = Math.ceil(bar / baristaRate);
    const kitHeads = Math.ceil(kit / kitchenRate);
    const heads = Math.max(SERVICE_FLOOR, barHeads + kitHeads);
    demand.set(`${h.dw}:${h.hr}`, heads);
    kitHeadsByHour.set(`${h.dw}:${h.hr}`, kitHeads);
    barHeadsByHour.set(`${h.dw}:${h.hr}`, barHeads);
    itemsByDow.set(h.dw, (itemsByDow.get(h.dw) ?? 0) + bar + kit);
    const prev = peakByDow.get(h.dw);
    if (!prev || heads > prev.heads) peakByDow.set(h.dw, { heads, hr: h.hr, bar: barHeads, kit: kitHeads });
  }

  return { demand, kitHeadsByHour, barHeadsByHour, itemsByDow, peakByDow, baristaRate, kitchenRate, calibrationNote };
}
