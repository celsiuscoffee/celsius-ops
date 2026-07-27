/**
 * Shared helpers for sales API routes.
 * Extracted from dashboard/route.ts for reuse in compare/route.ts.
 */

import type { StoreHubTransaction } from "@/lib/storehub";

// ─── Time Rounds (MYT = UTC+8) ──────────────────────────────────────────

export const ROUNDS = [
  { key: "breakfast", label: "Breakfast", startH: 8, endH: 10 },
  { key: "brunch", label: "Brunch", startH: 10, endH: 12 },
  { key: "lunch", label: "Lunch", startH: 12, endH: 15 },
  { key: "midday", label: "Midday", startH: 15, endH: 17 },
  { key: "evening", label: "Evening", startH: 17, endH: 19 },
  { key: "dinner", label: "Dinner", startH: 19, endH: 21 },
  { key: "supper", label: "Supper", startH: 21, endH: 23 },
] as const;

export type RoundKey = (typeof ROUNDS)[number]["key"];

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Convert a timestamp string to MYT hours (0-23) */
export function getMYTHour(dateStr: string): number {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return -1;
  const isUTC = /Z|[+-]\d{2}:\d{2}$/.test(dateStr);
  if (isUTC) {
    const myt = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return myt.getUTCHours();
  }
  return d.getUTCHours();
}

/** Get MYT date string (YYYY-MM-DD) from a timestamp */
export function getMYTDateStr(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "unknown";
  const isUTC = /Z|[+-]\d{2}:\d{2}$/.test(dateStr);
  if (isUTC) {
    const myt = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return myt.toISOString().split("T")[0];
  }
  return d.toISOString().split("T")[0];
}

/** Which round does this hour fall into? */
export function getRound(hour: number): RoundKey | null {
  for (const r of ROUNDS) {
    if (hour >= r.startH && hour < r.endH) return r.key;
  }
  return null;
}

/** Generate array of date strings between from and to (inclusive) */
export function getDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const start = new Date(from + "T00:00:00+08:00");
  const end = new Date(to + "T00:00:00+08:00");
  const cur = new Date(start);
  while (cur <= end) {
    const myt = new Date(cur.getTime() + 8 * 60 * 60 * 1000);
    dates.push(myt.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Detect delivery platform or QR table order */
export function isDeliveryOrQR(txn: StoreHubTransaction): boolean {
  const hints: string[] = [];
  if (txn.channel) hints.push(txn.channel.toLowerCase().trim());
  if (txn.remarks) hints.push(txn.remarks.toLowerCase().trim());
  if (txn.orderType) hints.push(txn.orderType.toLowerCase().trim());
  for (const [key, val] of Object.entries(txn)) {
    if (key === "items" || key === "channel" || key === "remarks" || key === "orderType") continue;
    if (typeof val === "string" && val.length < 50) hints.push(val.toLowerCase().trim());
  }
  const combined = hints.join(" ");
  return /\b(delivery|grab|grabfood|foodpanda|shopee|shopeefood)\b/.test(combined) ||
    /\b(qr[\s_-]?table|qr[\s_-]?order|qrtable)\b/.test(combined) ||
    hints.some((h) => h === "qr");
}

/** Classify a StoreHub transaction into dine_in | takeaway | delivery */
export function classifyChannel(txn: StoreHubTransaction): "dine_in" | "takeaway" | "delivery" {
  const hints: string[] = [];
  if (txn.channel) hints.push(txn.channel.toLowerCase().trim());
  if (txn.remarks) hints.push(txn.remarks.toLowerCase().trim());
  if (txn.orderType) hints.push(txn.orderType.toLowerCase().trim());
  if (txn.tags) {
    for (const tag of txn.tags) hints.push(tag.toLowerCase().trim());
  }
  for (const [key, val] of Object.entries(txn)) {
    if (key === "items" || key === "channel" || key === "remarks" || key === "orderType" || key === "tags") continue;
    if (typeof val === "string" && val.length < 50) {
      hints.push(val.toLowerCase().trim());
    }
  }
  const combined = hints.join(" ");
  if (/\b(grab|grabfood|foodpanda|shopee|shopeefood)\b/.test(combined)) return "delivery";
  if (/\bdelivery\b/.test(combined)) return "delivery";
  if (/\b(takeaway|take[\s-]?away|tapau|dabao|bungkus)\b/.test(combined)) return "takeaway";
  for (const h of hints) {
    if (h === "ta") return "takeaway";
  }
  if (/\b(dine[\s-]?in|dinein)\b/.test(combined)) return "dine_in";
  return "dine_in";
}

/** Is a date string (YYYY-MM-DD) a weekend (Sat=6, Sun=0)? */
export function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T12:00:00+08:00");
  const day = d.getDay();
  return day === 0 || day === 6;
}

// ─── Targets ────────────────────────────────────────────────────────────

type RoundTarget = {
  weekday: { revenue: number; orders: number; aov: number };
  weekend: { revenue: number; orders: number; aov: number };
};

export const ROUND_TARGETS: Record<RoundKey, RoundTarget> = {
  breakfast: { weekday: { revenue: 400, orders: 20, aov: 20 }, weekend: { revenue: 525, orders: 15, aov: 35 } },
  brunch:    { weekday: { revenue: 400, orders: 20, aov: 20 }, weekend: { revenue: 525, orders: 15, aov: 35 } },
  lunch:     { weekday: { revenue: 450, orders: 15, aov: 30 }, weekend: { revenue: 700, orders: 20, aov: 35 } },
  midday:    { weekday: { revenue: 450, orders: 15, aov: 30 }, weekend: { revenue: 350, orders: 10, aov: 35 } },
  evening:   { weekday: { revenue: 600, orders: 20, aov: 30 }, weekend: { revenue: 700, orders: 20, aov: 35 } },
  dinner:    { weekday: { revenue: 600, orders: 20, aov: 30 }, weekend: { revenue: 700, orders: 20, aov: 35 } },
  supper:    { weekday: { revenue: 375, orders: 15, aov: 25 }, weekend: { revenue: 450, orders: 15, aov: 30 } },
};

export const DELIVERY_TARGETS = {
  weekday: { revenue: 525, orders: 15, aov: 35 },
  weekend: { revenue: 525, orders: 15, aov: 15 },
};

/**
 * Get blended target for a round across a set of dates.
 *
 * Optional `overrides` lets callers inject AI-set / DB-backed targets so the
 * dashboard reflects progressive targets. If omitted, falls back to the
 * hardcoded ROUND_TARGETS defaults.
 */
export function getBlendedTarget(
  roundKey: RoundKey,
  dates: string[],
  overrides?: Partial<Record<RoundKey, RoundTarget>>,
): { revenue: number; orders: number; aov: number } {
  if (dates.length === 0) return { revenue: 0, orders: 0, aov: 0 };
  const table = overrides?.[roundKey] ?? ROUND_TARGETS[roundKey];
  let totalRev = 0, totalOrd = 0, totalAov = 0;
  for (const d of dates) {
    const t = isWeekend(d) ? table.weekend : table.weekday;
    totalRev += t.revenue;
    totalOrd += t.orders;
    totalAov += t.aov;
  }
  return {
    revenue: Math.round(totalRev / dates.length),
    orders: Math.round(totalOrd / dates.length),
    aov: Math.round((totalAov / dates.length) * 100) / 100,
  };
}

export function getBlendedDeliveryTarget(dates: string[]): { revenue: number; orders: number; aov: number } {
  if (dates.length === 0) return { revenue: 0, orders: 0, aov: 0 };
  let totalRev = 0, totalOrd = 0, totalAov = 0;
  for (const d of dates) {
    const t = isWeekend(d) ? DELIVERY_TARGETS.weekend : DELIVERY_TARGETS.weekday;
    totalRev += t.revenue;
    totalOrd += t.orders;
    totalAov += t.aov;
  }
  return {
    revenue: Math.round(totalRev / dates.length),
    orders: Math.round(totalOrd / dates.length),
    aov: Math.round((totalAov / dates.length) * 100) / 100,
  };
}

// ─── Channel breakdown type ─────────────────────────────────────────────

export type ChannelBreakdown = {
  revenue: number;
  orders: number;
};

export type ChannelData = {
  dineIn: ChannelBreakdown;
  takeaway: ChannelBreakdown;
  delivery: ChannelBreakdown;
};

export function emptyChannelData(): ChannelData {
  return {
    dineIn: { revenue: 0, orders: 0 },
    takeaway: { revenue: 0, orders: 0 },
    delivery: { revenue: 0, orders: 0 },
  };
}

export function addToChannel(
  data: ChannelData,
  channel: "dine_in" | "takeaway" | "delivery",
  revenue: number,
  units = 1,
) {
  if (channel === "dine_in") {
    data.dineIn.revenue += revenue;
    data.dineIn.orders += units;
  } else if (channel === "takeaway") {
    data.takeaway.revenue += revenue;
    data.takeaway.orders += units;
  } else {
    data.delivery.revenue += revenue;
    data.delivery.orders += units;
  }
}

export function roundChannel(ch: ChannelBreakdown): ChannelBreakdown {
  return {
    revenue: Math.round(ch.revenue * 100) / 100,
    orders: ch.orders,
  };
}

export function roundChannelData(data: ChannelData): ChannelData {
  return {
    dineIn: roundChannel(data.dineIn),
    takeaway: roundChannel(data.takeaway),
    delivery: roundChannel(data.delivery),
  };
}
