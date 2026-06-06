import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";
import {
  type Mode, type ChannelKey, type PayKey, type RoundKey,
  rangesForMode, getMYTToday, getMYTHourNow, getMYTDateStr, getMYTHour, getRound,
  mytDayStartUTC, mytDayEndUTC, addDays,
  ROUNDS, CHANNEL_LABELS, PAY_LABELS,
  classifyPosChannel, classifyAppChannel, normalizePayment,
  isPosSale, isAppSale, rm, round2, pctChange,
} from "../_lib/sales-helpers";

// GET /api/sales/dashboard?mode=day|week|month|custom&from=&to=&outletId=
// Consolidated native POS (pos_orders + pos_order_payments) + pickup (orders).
// Auth: getSession (cookie for web staff, Bearer for native staff).

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const mode = (sp.get("mode") || "day") as Mode;
  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
  const outletId = (isAdmin && sp.get("outletId")) || user.outletId;
  if (!outletId) return NextResponse.json({ error: "No outlet" }, { status: 400 });

  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, name: true, pickupStoreId: true },
  });
  if (!outlet) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
  const storeId = outlet.pickupStoreId; // orders.store_id; may be null

  const { cur, prev, granularity } = rangesForMode(mode, sp.get("from"), sp.get("to"));
  const today = getMYTToday();
  const nowHour = getMYTHourNow();

  // Fetch window spans both periods (prev.from → cur.to) in one pass.
  const winStart = mytDayStartUTC(prev.from);
  const winEnd = mytDayEndUTC(cur.to);
  const priorCut = mytDayStartUTC(prev.from); // "before previous period" boundary

  const [posRes, appRes, posPriorRes, appPriorRes] = await Promise.all([
    supabaseAdmin
      .from("pos_orders")
      .select("id, created_at, subtotal, total, status, order_type, source, customer_phone, refund_of_order_id")
      .eq("outlet_id", outletId)
      .gte("created_at", winStart).lte("created_at", winEnd)
      .limit(20000),
    storeId
      ? supabaseAdmin
          .from("orders")
          .select("id, created_at, subtotal, total, status, order_type, customer_phone, payment_method")
          .eq("store_id", storeId)
          .gte("created_at", winStart).lte("created_at", winEnd)
          .limit(20000)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from("pos_orders").select("customer_phone")
      .eq("outlet_id", outletId).lt("created_at", priorCut)
      .not("customer_phone", "is", null).limit(50000),
    storeId
      ? supabaseAdmin
          .from("orders").select("customer_phone")
          .eq("store_id", storeId).lt("created_at", priorCut)
          .not("customer_phone", "is", null).limit(50000)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const warn: string[] = [];
  for (const [name, r] of [["pos_orders", posRes], ["orders", appRes]] as const) {
    if (r.error) warn.push(`${name}: ${r.error.message}`);
  }
  const posRows = (posRes.data || []) as PosRow[];
  const appRows = (appRes.data || []) as AppRow[];

  // ── Date axis ──
  const curDates = dateRange(cur.from, cur.to);
  const prevDates = dateRange(prev.from, prev.to);
  const curIncludesToday = cur.to >= today;

  // ── Accumulators ──
  const acc = (n: number) => Array.from({ length: n }, () => 0);
  // series buckets (net sen)
  const curHour = acc(24), prevHour = acc(24);
  const curByDate: Record<string, number> = {}, prevByDate: Record<string, number> = {};
  for (const d of curDates) curByDate[d] = 0;
  for (const d of prevDates) prevByDate[d] = 0;
  // summary
  let curRev = 0, curOrd = 0, prevRev = 0, prevOrd = 0;
  // current-period breakdowns
  const chanRev: Record<ChannelKey, number> = { dine_in: 0, takeaway: 0, pickup: 0, delivery: 0 };
  const roundRev: Record<string, number> = {};
  for (const r of ROUNDS) roundRev[r.key] = 0;
  const payAmt: Record<string, number> = {};
  // growth phone sets
  const curPhones = new Set<string>(), prevPhones = new Set<string>();
  const curAppPhones = new Set<string>(), prevAppPhones = new Set<string>();
  let curAppOrd = 0, curPosOrd = 0, prevAppOrd = 0, prevPosOrd = 0;
  const curPosIds: string[] = [];

  const inCur = (d: string) => d >= cur.from && d <= cur.to;
  const inPrev = (d: string) => d >= prev.from && d <= prev.to;

  for (const r of posRows) {
    if (!isPosSale(r.status, r.refund_of_order_id)) continue;
    const d = getMYTDateStr(r.created_at);
    const net = r.subtotal || 0;
    if (inCur(d)) {
      curRev += net; curOrd++; curPosOrd++;
      if (r.customer_phone) curPhones.add(r.customer_phone);
      curPosIds.push(r.id);
      curByDate[d] = (curByDate[d] || 0) + net;
      curHour[getMYTHour(r.created_at)] += net;
      chanRev[classifyPosChannel(r.order_type, r.source)] += net;
      const rd = getRound(getMYTHour(r.created_at)); if (rd) roundRev[rd] += net;
    } else if (inPrev(d)) {
      prevRev += net; prevOrd++; prevPosOrd++;
      if (r.customer_phone) prevPhones.add(r.customer_phone);
      prevByDate[d] = (prevByDate[d] || 0) + net;
      prevHour[getMYTHour(r.created_at)] += net;
    }
  }
  for (const r of appRows) {
    if (!isAppSale(r.status)) continue;
    const d = getMYTDateStr(r.created_at);
    const net = r.subtotal || 0;
    if (inCur(d)) {
      curRev += net; curOrd++; curAppOrd++;
      if (r.customer_phone) { curPhones.add(r.customer_phone); curAppPhones.add(r.customer_phone); }
      curByDate[d] = (curByDate[d] || 0) + net;
      curHour[getMYTHour(r.created_at)] += net;
      chanRev[classifyAppChannel(r.order_type)] += net;
      const rd = getRound(getMYTHour(r.created_at)); if (rd) roundRev[rd] += net;
      const pk = normalizePayment(r.payment_method);
      payAmt[pk] = (payAmt[pk] || 0) + (r.total || 0);
    } else if (inPrev(d)) {
      prevRev += net; prevOrd++; prevAppOrd++;
      if (r.customer_phone) { prevPhones.add(r.customer_phone); prevAppPhones.add(r.customer_phone); }
      prevByDate[d] = (prevByDate[d] || 0) + net;
      prevHour[getMYTHour(r.created_at)] += net;
    }
  }

  // ── POS payment split (current period) ──
  if (curPosIds.length) {
    const payRes = await supabaseAdmin
      .from("pos_order_payments")
      .select("order_id, payment_method, amount, refund_amount")
      .in("order_id", curPosIds.slice(0, 5000))
      .limit(20000);
    if (payRes.error) warn.push(`pos_order_payments: ${payRes.error.message}`);
    for (const p of (payRes.data || []) as PayRow[]) {
      const pk = normalizePayment(p.payment_method);
      payAmt[pk] = (payAmt[pk] || 0) + ((p.amount || 0) - (p.refund_amount || 0));
    }
  }

  // ── Series (client makes it cumulative) ──
  let series: { label: string; cur: number | null; prev: number }[];
  if (granularity === "hour") {
    series = Array.from({ length: 24 }, (_, h) => ({
      label: fmtHour(h),
      cur: curIncludesToday && h > nowHour ? null : rm(curHour[h]),
      prev: rm(prevHour[h]),
    }));
  } else {
    series = curDates.map((d, i) => {
      const pd = prevDates[i];
      return {
        label: mode === "week" ? WK[/* dow */ new Date(`${d}T12:00:00+08:00`).getDay()] : fmtDayMon(d),
        cur: d > today ? null : rm(curByDate[d] || 0),
        prev: pd != null ? rm(prevByDate[pd] || 0) : 0,
      };
    });
  }

  // ── Channels / rounds / payments ──
  const totalChan = Object.values(chanRev).reduce((s, v) => s + v, 0) || 1;
  const channels = (Object.keys(chanRev) as ChannelKey[])
    .map((k) => ({ key: k, label: CHANNEL_LABELS[k], revenue: rm(chanRev[k]), pct: Math.round((chanRev[k] / totalChan) * 100) }))
    .filter((c) => c.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);
  const rounds = ROUNDS.map((r) => ({ key: r.key, label: r.label, revenue: rm(roundRev[r.key] || 0) }));
  const totalPay = Object.values(payAmt).reduce((s, v) => s + v, 0) || 1;
  const payments = (Object.keys(payAmt) as PayKey[])
    .map((k) => ({ key: k, label: PAY_LABELS[k] ?? k, amount: rm(payAmt[k]), pct: Math.round((payAmt[k] / totalPay) * 100) }))
    .filter((p) => p.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // ── Growth ──
  const priorAll = new Set<string>();
  for (const r of (posPriorRes.data || []) as { customer_phone: string | null }[]) if (r.customer_phone) priorAll.add(r.customer_phone);
  for (const r of (appPriorRes.data || []) as { customer_phone: string | null }[]) if (r.customer_phone) priorAll.add(r.customer_phone);
  const priorApp = new Set<string>();
  for (const r of (appPriorRes.data || []) as { customer_phone: string | null }[]) if (r.customer_phone) priorApp.add(r.customer_phone);

  // new = first seen within the period (not before its start)
  const newCustomers = [...curPhones].filter((p) => !priorAll.has(p) && !prevPhones.has(p)).length;
  const prevNewCustomers = [...prevPhones].filter((p) => !priorAll.has(p)).length;
  const newAppCustomers = [...curAppPhones].filter((p) => !priorApp.has(p) && !prevAppPhones.has(p)).length;
  const prevNewApp = [...prevAppPhones].filter((p) => !priorApp.has(p)).length;
  const curShare = curOrd ? Math.round((curAppOrd / curOrd) * 100) : 0;
  const prevShare = prevOrd ? Math.round((prevAppOrd / prevOrd) * 100) : 0;

  return NextResponse.json({
    outletId: outlet.id,
    outletName: outlet.name,
    mode,
    granularity,
    cur: { ...cur, label: labelFor(mode, "cur") },
    prev: { ...prev, label: labelFor(mode, "prev") },
    summary: {
      revenue: rm(curRev), orders: curOrd, aov: curOrd ? round2(rm(curRev) / curOrd) : 0,
      prevRevenue: rm(prevRev), prevOrders: prevOrd, prevAov: prevOrd ? round2(rm(prevRev) / prevOrd) : 0,
      revenueDelta: pctChange(curRev, prevRev),
      ordersDelta: pctChange(curOrd, prevOrd),
      aovDelta: pctChange(curOrd ? curRev / curOrd : 0, prevOrd ? prevRev / prevOrd : 0),
    },
    series,
    channels,
    rounds,
    payments,
    growth: {
      newCustomers, newCustomersDelta: pctChange(newCustomers, prevNewCustomers),
      newAppCustomers, newAppDelta: pctChange(newAppCustomers, prevNewApp),
      appSharePct: curShare, appShareDeltaPts: curShare - prevShare,
    },
    ...(warn.length ? { warnings: warn } : {}),
  });
}

// ── local types + tiny helpers ──
type PosRow = { id: string; created_at: string; subtotal: number | null; total: number | null; status: string | null; order_type: string | null; source: string | null; customer_phone: string | null; refund_of_order_id: string | null };
type AppRow = { id: string; created_at: string; subtotal: number | null; total: number | null; status: string | null; order_type: string | null; customer_phone: string | null; payment_method: string | null };
type PayRow = { order_id: string; payment_method: string | null; amount: number | null; refund_amount: number | null };

const WK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let d = from;
  for (let i = 0; i < 400 && d <= to; i++) { out.push(d); d = addDays(d, 1); }
  return out;
}
function fmtHour(h: number): string {
  if (h === 0) return "12AM";
  if (h < 12) return `${h}AM`;
  if (h === 12) return "12PM";
  return `${h - 12}PM`;
}
function fmtDayMon(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}
function labelFor(mode: Mode, which: "cur" | "prev"): string {
  const m: Record<Mode, [string, string]> = {
    day: ["Today", "Yesterday"], week: ["This week", "Last week"],
    month: ["This month", "Last month"], custom: ["Selected", "Previous"],
  };
  return m[mode][which === "cur" ? 0 : 1];
}
