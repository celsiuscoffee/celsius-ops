/**
 * StoreHub contributions for the staff Sales dashboard — read DIRECTLY from the
 * shared `storehub_sales` archive (same DB the route already queries for
 * pos_orders/orders). No cross-app bridge, no JWT — so it can't 401.
 *
 * Cutover-routed like the backoffice unified reader: pre-cutover keep ALL
 * StoreHub; post-cutover keep ONLY external/online rows (Grab/Beep/offline —
 * they carry a `channel`) and drop channel-less till rows, which are on
 * pos_orders now (keeping them would double-count). Returns SEN so the dashboard
 * route adds it straight onto the native pos+pickup totals.
 *
 * "Today" freshness depends on the storehub-sync cron (now hourly) populating
 * the archive — the staff app has no live StoreHub client, so today can lag
 * ≤1h vs the backoffice's live pull. StoreHub gives revenue/orders/channels/
 * trend only — payment-method + customer growth stay native/app-only.
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  getMYTDateStr, getMYTHour, getRound, ROUNDS, mytDayStartUTC, mytDayEndUTC,
} from "./sales-helpers";

const sen = (rm: number) => Math.round((rm || 0) * 100);

export type ShContrib = {
  curRevSen: number; curOrd: number; prevRevSen: number; prevOrd: number;
  curHour: number[]; prevHour: number[];
  curByDate: Record<string, number>; prevByDate: Record<string, number>;
  chan: { dine_in: number; takeaway: number; delivery: number };
  chanOrders: { dine_in: number; takeaway: number; delivery: number };
  rounds: Record<string, number>;
  roundOrders: Record<string, number>;
  warnings: string[];
};

type ShRow = {
  outlet_id: string;
  transaction_time: Date | string;
  total: number | string | null;
  channel: string | null;
  order_type: string | null;
  is_cancelled: boolean | null;
};

/** StoreHub channel/order_type → the dashboard's 3 channels (Grab/Beep → delivery). */
function classifyShChannel(channel: string | null, orderType: string | null): "dine_in" | "takeaway" | "delivery" {
  const s = `${channel ?? ""} ${orderType ?? ""}`.toLowerCase();
  if (/grab|foodpanda|shopee|deliveroo|beep|deliver/.test(s)) return "delivery";
  if (/take|tapau|dabao|bungkus|pickup/.test(s)) return "takeaway";
  return "dine_in";
}

export async function getStorehubFromDB(opts: {
  outlets: { id: string; cutoverAt: Date | null }[];
  cur: { from: string; to: string };
  prev: { from: string; to: string };
  granularity: "hour" | "day";
  /** Like-for-like cutoff (ms): prev-period SUMMARY counts only rows at/before
   *  this instant (today-so-far vs yesterday-to-same-time), mirroring the
   *  route's native rows. Chart buckets (prevHour/prevByDate) stay full. */
  prevCutoffMs?: number;
}): Promise<ShContrib> {
  const out: ShContrib = {
    curRevSen: 0, curOrd: 0, prevRevSen: 0, prevOrd: 0,
    curHour: Array.from({ length: 24 }, () => 0),
    prevHour: Array.from({ length: 24 }, () => 0),
    curByDate: {}, prevByDate: {},
    chan: { dine_in: 0, takeaway: 0, delivery: 0 },
    chanOrders: { dine_in: 0, takeaway: 0, delivery: 0 },
    rounds: {},
    roundOrders: {},
    warnings: [],
  };
  if (opts.outlets.length === 0) return out;

  const ids = opts.outlets.map((o) => o.id);
  const cutover = new Map(opts.outlets.map((o) => [o.id, o.cutoverAt] as const));
  const winStart = mytDayStartUTC(opts.prev.from);
  const winEnd = mytDayEndUTC(opts.cur.to);

  // Pull via raw SQL (like the backoffice unified reader) — NOT the PostgREST
  // client. supabaseAdmin.from().select() is silently capped at ~1000 rows, so a
  // wide window (week/month/custom = 1000s of rows) was truncated to the OLDEST
  // ~1000 and the current period lost its StoreHub entirely; Day only worked
  // because its window fits in a single page. Raw SQL has no such cap.
  let data: ShRow[] = [];
  try {
    data = await prisma.$queryRaw<ShRow[]>`
      SELECT outlet_id, transaction_time, total, channel, order_type, is_cancelled
      FROM storehub_sales
      WHERE outlet_id IN (${Prisma.join(ids)})
        AND transaction_time >= ${new Date(winStart)}
        AND transaction_time <= ${new Date(winEnd)}
    `;
  } catch (e) {
    out.warnings.push(`storehub_sales: ${e instanceof Error ? e.message : "query failed"}`);
    return out;
  }

  const inCur = (d: string) => d >= opts.cur.from && d <= opts.cur.to;
  const inPrev = (d: string) => d >= opts.prev.from && d <= opts.prev.to;

  for (const r of data) {
    if (r.is_cancelled === true) continue;
    const ts = typeof r.transaction_time === "string" ? r.transaction_time : r.transaction_time.toISOString();
    // Cutover routing: after cutover keep only channel-carrying (external) rows;
    // channel-less till rows are on pos_orders now → keeping them double-counts.
    const co = cutover.get(r.outlet_id);
    if (co && new Date(ts).getTime() >= co.getTime()) {
      if (!(r.channel && r.channel.trim() !== "")) continue;
    }
    const d = getMYTDateStr(ts);
    const h = getMYTHour(ts);
    // Revenue = `total` (net of discounts), matching the backoffice unified
    // reader. `sub_total` is the pre-discount gross and over-counts — the same
    // basis fix applied to the native pos/orders loops in the route.
    const rev = sen(Number(r.total ?? 0) || 0);
    const ch = classifyShChannel(r.channel, r.order_type);
    if (inCur(d)) {
      out.curRevSen += rev; out.curOrd++;
      out.curByDate[d] = (out.curByDate[d] || 0) + rev;
      out.curHour[h] += rev;
      out.chan[ch] += rev; out.chanOrders[ch]++;
      const rd = getRound(h);
      if (rd) {
        out.rounds[rd] = (out.rounds[rd] || 0) + rev;
        out.roundOrders[rd] = (out.roundOrders[rd] || 0) + 1;
      }
    } else if (inPrev(d)) {
      if (new Date(ts).getTime() <= (opts.prevCutoffMs ?? Number.POSITIVE_INFINITY)) {
        out.prevRevSen += rev; out.prevOrd++;
      }
      out.prevByDate[d] = (out.prevByDate[d] || 0) + rev;
      out.prevHour[h] += rev;
    }
  }
  return out;
}
