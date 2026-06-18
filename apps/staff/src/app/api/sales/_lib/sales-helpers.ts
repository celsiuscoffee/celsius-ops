/**
 * Helpers for the consolidated staff Sales API (native POS + pickup).
 * NOT StoreHub — aggregates pos_orders + pos_order_payments + orders.
 * All money is stored in SEN (integer); callers convert to RM at the edge.
 * Day boundaries + dayparts are MYT (UTC+8, no DST).
 */

import { dowMYT, startOfMonthMYT, endOfMonthMYT } from "@celsius/shared";

// ─── MYT time ──────────────────────────────────────────────────────────────
export function getMYTToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().split("T")[0];
}
export function getMYTHourNow(): number {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours();
}
/** YYYY-MM-DD (MYT) from a UTC/ISO timestamp. */
export function getMYTDateStr(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "unknown";
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().split("T")[0];
}
/** Hour 0–23 (MYT) from a UTC/ISO timestamp. */
export function getMYTHour(ts: string): number {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return -1;
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).getUTCHours();
}
/** UTC ISO bound for a MYT calendar day edge. */
export function mytDayStartUTC(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+08:00`).toISOString();
}
export function mytDayEndUTC(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59.999+08:00`).toISOString();
}
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}
// Week/month boundaries come from @celsius/shared so the staff dashboard,
// the backoffice headline, and the comparison chart share ONE definition of
// "this week" (calendar week, Sun-start) and "this month". These thin wrappers
// keep the local call sites unchanged.
export function dayOfWeek(dateStr: string): number {
  return dowMYT(dateStr); // 0=Sun
}
export function monthStart(dateStr: string): string {
  return startOfMonthMYT(dateStr);
}
export function monthEnd(dateStr: string): string {
  return endOfMonthMYT(dateStr);
}
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00+08:00`);
  const b = new Date(`${to}T12:00:00+08:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

// ─── Period resolution ───────────────────────────────────────────────────────
export type Mode = "day" | "week" | "month" | "custom";
export type Granularity = "hour" | "day";
export type Range = { from: string; to: string };

/** Current + previous calendar period + bucket granularity for a mode. */
export function rangesForMode(mode: Mode, from?: string | null, to?: string | null): {
  cur: Range; prev: Range; granularity: Granularity;
} {
  const today = getMYTToday();
  if (mode === "week") {
    const sun = addDays(today, -dayOfWeek(today));
    return {
      cur: { from: sun, to: addDays(sun, 6) },
      prev: { from: addDays(sun, -7), to: addDays(sun, -1) },
      granularity: "day",
    };
  }
  if (mode === "month") {
    const ms = monthStart(today);
    const lastEnd = addDays(ms, -1);
    return {
      cur: { from: ms, to: monthEnd(today) },
      prev: { from: monthStart(lastEnd), to: lastEnd },
      granularity: "day",
    };
  }
  if (mode === "custom" && from && to) {
    const f = from <= to ? from : to;
    const t = from <= to ? to : from;
    const n = daysBetween(f, t);
    return {
      cur: { from: f, to: t },
      prev: { from: addDays(f, -n), to: addDays(f, -1) },
      granularity: n <= 1 ? "hour" : "day",
    };
  }
  // day
  const y = addDays(today, -1);
  return { cur: { from: today, to: today }, prev: { from: y, to: y }, granularity: "hour" };
}

// ─── Dayparts (rounds) ───────────────────────────────────────────────────────
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
export function getRound(hour: number): RoundKey | null {
  for (const r of ROUNDS) if (hour >= r.startH && hour < r.endH) return r.key;
  return null;
}

// ─── Channel classification ──────────────────────────────────────────────────
export type ChannelKey = "dine_in" | "takeaway" | "pickup" | "delivery" | "qr_table";
/** Classify a POS counter order (pos_orders). Counter dine-in stays "dine_in";
 *  the POS has no table/QR ordering, so qr_table never originates here. */
export function classifyPosChannel(orderType?: string | null, source?: string | null): ChannelKey {
  const s = (source || "").toLowerCase();
  if (/grab|foodpanda|shopee|delivery/.test(s)) return "delivery";
  const t = (orderType || "").toLowerCase();
  if (/takeaway|take[\s-]?away|tapau|bungkus|ta\b/.test(t)) return "takeaway";
  if (/pickup/.test(t)) return "pickup";
  return "dine_in"; // counter dine_in / default
}
/** Classify an app order (orders). App dine-in is always table-based ordering
 *  — the customer scans a QR at the table, so every app dine_in row carries a
 *  table_number (newer ones also source "web_qr"). It therefore maps to the
 *  distinct "qr_table" channel instead of being merged into counter dine-in. */
export function classifyAppChannel(
  orderType?: string | null,
  tableNumber?: string | null,
  source?: string | null,
): ChannelKey {
  const t = (orderType || "").toLowerCase();
  const s = (source || "").toLowerCase();
  const hasTable = !!(tableNumber && tableNumber.trim());
  if (s.includes("qr") || hasTable || /qr[\s-]?table/.test(t)) return "qr_table";
  if (/dine[\s-]?in|dinein/.test(t)) return "qr_table";
  if (/takeaway|take[\s-]?away|tapau|bungkus/.test(t)) return "takeaway";
  if (/grab|delivery/.test(t)) return "delivery";
  return "pickup";
}
export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  dine_in: "Dine-in", takeaway: "Takeaway", pickup: "Pickup", delivery: "Grab", qr_table: "QR Table",
};

// ─── Payment-method normalisation ────────────────────────────────────────────
export type PayKey = "cash" | "card" | "duitnow_qr" | "tng" | "grabpay" | "shopeepay" | "fpx" | "wallet";
export function normalizePayment(method?: string | null): PayKey {
  const m = (method || "").toLowerCase().replace(/[\s_-]/g, "");
  if (m === "cash") return "cash";
  if (m === "qr" || m.includes("duitnow")) return "duitnow_qr";
  if (m === "tng" || m.includes("touchngo") || m.includes("touchego")) return "tng";
  if (m === "grabpay") return "grabpay";
  if (m === "shopeepay") return "shopeepay";
  if (m === "fpx") return "fpx";
  if (m.includes("card") || m === "applepay" || m === "googlepay" || m === "visa" || m === "mastercard") return "card";
  if (m.includes("wallet") || m.includes("ewallet")) return "wallet";
  return "wallet";
}
export const PAY_LABELS: Record<PayKey, string> = {
  cash: "Cash", card: "Card", duitnow_qr: "DuitNow QR", tng: "Touch 'n Go",
  grabpay: "GrabPay", shopeepay: "ShopeePay", fpx: "FPX", wallet: "e-Wallet",
};

// ─── Status filters (count only real, non-voided, non-refund sales) ──────────
export function isPosSale(status?: string | null, refundOf?: string | null): boolean {
  if (refundOf) return false;
  const s = (status || "").toLowerCase();
  return s === "completed" || s === "paid";
}
export function isAppSale(status?: string | null): boolean {
  const s = (status || "").toLowerCase();
  return s === "paid" || s === "preparing" || s === "ready" || s === "completed" || s === "collected";
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
/** sen → RM */
export function rm(sen: number): number {
  return Math.round(sen) / 100;
}
export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return cur > 0 ? null : 0; // null = "New"
  return round2(((cur - prev) / prev) * 100);
}
