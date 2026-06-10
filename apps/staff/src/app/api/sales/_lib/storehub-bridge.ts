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
import { supabaseAdmin } from "@/lib/supabase";
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
  transaction_time: string;
  sub_total: number | null;
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

  const { data, error } = await supabaseAdmin
    .from("storehub_sales")
    .select("outlet_id, transaction_time, sub_total, channel, order_type, is_cancelled")
    .in("outlet_id", ids)
    .gte("transaction_time", winStart)
    .lte("transaction_time", winEnd)
    .limit(100000);

  if (error) {
    out.warnings.push(`storehub_sales: ${error.message}`);
    return out;
  }

  const inCur = (d: string) => d >= opts.cur.from && d <= opts.cur.to;
  const inPrev = (d: string) => d >= opts.prev.from && d <= opts.prev.to;

  for (const r of (data || []) as ShRow[]) {
    if (r.is_cancelled === true) continue;
    // Cutover routing: after cutover keep only channel-carrying (external) rows;
    // channel-less till rows are on pos_orders now → keeping them double-counts.
    const co = cutover.get(r.outlet_id);
    if (co && new Date(r.transaction_time).getTime() >= co.getTime()) {
      if (!(r.channel && r.channel.trim() !== "")) continue;
    }
    const d = getMYTDateStr(r.transaction_time);
    const h = getMYTHour(r.transaction_time);
    const rev = sen(r.sub_total || 0);
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
      out.prevRevSen += rev; out.prevOrd++;
      out.prevByDate[d] = (out.prevByDate[d] || 0) + rev;
      out.prevHour[h] += rev;
    }
  }
  return out;
}
