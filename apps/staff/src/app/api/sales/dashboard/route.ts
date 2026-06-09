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
import { fetchStorehubContributions } from "../_lib/storehub-bridge";

// GET /api/sales/dashboard?mode=day|week|month|custom&from=&to=&outletId=
// Consolidated native POS (pos_orders + pos_order_payments) + pickup (orders).
// Auth: getSession (cookie for web staff, Bearer for native staff).

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const mode = (sp.get("mode") || "day") as Mode;
  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
  const reqOutlet = sp.get("outletId");
  // Admins default to "all" (overall) and may drill into one outlet; everyone
  // else is locked to their assigned outlet (client param ignored).
  const scope = isAdmin ? (reqOutlet || "all") : user.outletId;
  if (!scope) return NextResponse.json({ error: "No outlet" }, { status: 400 });

  let posCodes: string[] = [];
  let storeIds: string[] = [];
  let outletName = "";
  let scopeId = "";
  let availableOutlets: { id: string; name: string }[] = [];
  let scopeOutlets: { id: string; storehubId: string | null; posCode: string | null }[] = [];

  if (isAdmin) {
    const all = await prisma.outlet.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, pickupStoreId: true, storehubId: true },
      orderBy: { name: "asc" },
    });
    availableOutlets = all.map((o) => ({ id: o.id, name: o.name }));
    const pick = scope === "all" ? all : all.filter((x) => x.id === scope);
    if (scope !== "all" && pick.length === 0) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
    scopeOutlets = pick.map((o) => ({ id: o.id, storehubId: o.storehubId, posCode: posCodeFor(o) }));
    storeIds = pick.map((o) => o.pickupStoreId).filter((s): s is string => !!s);
    outletName = scope === "all" ? "All outlets" : pick[0].name;
    scopeId = scope === "all" ? "all" : pick[0].id;
  } else {
    const o = await prisma.outlet.findUnique({
      where: { id: scope },
      select: { id: true, name: true, pickupStoreId: true, storehubId: true },
    });
    if (!o) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
    scopeOutlets = [{ id: o.id, storehubId: o.storehubId, posCode: posCodeFor(o) }];
    storeIds = o.pickupStoreId ? [o.pickupStoreId] : [];
    outletName = o.name;
    scopeId = o.id;
  }
  posCodes = scopeOutlets.map((o) => o.posCode).filter((c): c is string => !!c);

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
      .select("id, outlet_id, created_at, subtotal, total, status, order_type, source, customer_phone, refund_of_order_id")
      .in("outlet_id", posCodes)
      .gte("created_at", winStart).lte("created_at", winEnd)
      .limit(20000),
    storeIds.length
      ? supabaseAdmin
          .from("orders")
          .select("id, created_at, subtotal, total, status, order_type, customer_phone, payment_method, table_number, source")
          .in("store_id", storeIds)
          .gte("created_at", winStart).lte("created_at", winEnd)
          .limit(20000)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from("pos_orders").select("customer_phone")
      .in("outlet_id", posCodes).lt("created_at", priorCut)
      .not("customer_phone", "is", null).limit(50000),
    storeIds.length
      ? supabaseAdmin
          .from("orders").select("customer_phone")
          .in("store_id", storeIds).lt("created_at", priorCut)
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

  // Like-for-like comparison: when the current period is still in progress
  // (includes today), the previous period's *summary* total is counted only up
  // to the same elapsed point — e.g. today-so-far vs yesterday up to the same
  // time of day — so the headline delta isn't "partial day vs full day". For a
  // fully past period the cutoff is open (full previous period). The comparison
  // chart's previous line is intentionally left full (shows yesterday's finish
  // as a target); only the summary deltas use this cutoff.
  // NOTE: StoreHub-sourced previous totals (transitioning outlets) are not
  // time-clipped — they still merge the full previous period below.
  const prevCutoffMs = curIncludesToday
    ? Date.parse(mytDayStartUTC(prev.from)) + (Date.now() - Date.parse(mytDayStartUTC(cur.from)))
    : Number.POSITIVE_INFINITY;

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
  const chanRev: Record<ChannelKey, number> = { dine_in: 0, takeaway: 0, pickup: 0, delivery: 0, qr_table: 0 };
  const roundRev: Record<string, number> = {};
  for (const r of ROUNDS) roundRev[r.key] = 0;
  // order-count accumulators, mirroring the revenue ones above
  const chanOrd: Record<ChannelKey, number> = { dine_in: 0, takeaway: 0, pickup: 0, delivery: 0, qr_table: 0 };
  const roundOrd: Record<string, number> = {};
  for (const r of ROUNDS) roundOrd[r.key] = 0;
  const payAmt: Record<string, number> = {};
  // growth phone sets
  const curPhones = new Set<string>(), prevPhones = new Set<string>();
  const curAppPhones = new Set<string>(), prevAppPhones = new Set<string>();
  let curAppOrd = 0, curPosOrd = 0, prevAppOrd = 0, prevPosOrd = 0;
  const curPosIds: string[] = [];
  const nativeCodes = new Set<string>(); // pos outlet-codes with native sales this period

  const inCur = (d: string) => d >= cur.from && d <= cur.to;
  const inPrev = (d: string) => d >= prev.from && d <= prev.to;

  for (const r of posRows) {
    if (!isPosSale(r.status, r.refund_of_order_id)) continue;
    const d = getMYTDateStr(r.created_at);
    const net = r.subtotal || 0;
    if (inCur(d)) {
      curRev += net; curOrd++; curPosOrd++;
      nativeCodes.add(r.outlet_id);
      if (r.customer_phone) curPhones.add(r.customer_phone);
      curPosIds.push(r.id);
      curByDate[d] = (curByDate[d] || 0) + net;
      curHour[getMYTHour(r.created_at)] += net;
      const pch = classifyPosChannel(r.order_type, r.source); chanRev[pch] += net; chanOrd[pch]++;
      const rd = getRound(getMYTHour(r.created_at)); if (rd) { roundRev[rd] += net; roundOrd[rd]++; }
    } else if (inPrev(d)) {
      if (Date.parse(r.created_at) <= prevCutoffMs) { prevRev += net; prevOrd++; prevPosOrd++; }
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
      const ach = classifyAppChannel(r.order_type, r.table_number, r.source); chanRev[ach] += net; chanOrd[ach]++;
      const rd = getRound(getMYTHour(r.created_at)); if (rd) { roundRev[rd] += net; roundOrd[rd]++; }
      const pk = normalizePayment(r.payment_method);
      payAmt[pk] = (payAmt[pk] || 0) + (r.total || 0);
    } else if (inPrev(d)) {
      if (Date.parse(r.created_at) <= prevCutoffMs) { prevRev += net; prevOrd++; prevAppOrd++; }
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

  // ── StoreHub (transition mode) — merge from the backoffice sales module ──
  // Sum StoreHub + native for ANY outlet that still has a storehubId. A sale
  // rings in exactly one system (StoreHub OR the new POS), so summing both is
  // correct (no double-count) and captures both sides of a transitioning day.
  const shScope = scopeOutlets.filter((o) => o.storehubId);
  console.warn(`[sales] codes=[${posCodes.join(",")}] native=[${[...nativeCodes].join(",")}] shScope=[${shScope.map((o) => o.id).join(",")}] authz=${req.headers.get("authorization") ? "y" : "n"}`);
  if (shScope.length) {
    const sh = await fetchStorehubContributions({
      baseUrl: process.env.BACKOFFICE_URL ?? "https://backoffice.celsiuscoffee.com",
      authz: req.headers.get("authorization"),
      outlets: shScope,
      cur,
      prev,
      granularity,
    });
    curRev += sh.curRevSen; curOrd += sh.curOrd;
    prevRev += sh.prevRevSen; prevOrd += sh.prevOrd;
    for (let h = 0; h < 24; h++) { curHour[h] += sh.curHour[h]; prevHour[h] += sh.prevHour[h]; }
    for (const dt in sh.curByDate) if (curByDate[dt] != null) curByDate[dt] += sh.curByDate[dt];
    for (const dt in sh.prevByDate) if (prevByDate[dt] != null) prevByDate[dt] += sh.prevByDate[dt];
    chanRev.dine_in += sh.chan.dine_in; chanRev.takeaway += sh.chan.takeaway; chanRev.delivery += sh.chan.delivery;
    chanOrd.dine_in += sh.chanOrders.dine_in; chanOrd.takeaway += sh.chanOrders.takeaway; chanOrd.delivery += sh.chanOrders.delivery;
    for (const k in sh.rounds) if (roundRev[k] != null) roundRev[k] += sh.rounds[k];
    for (const k in sh.roundOrders) if (roundOrd[k] != null) roundOrd[k] += sh.roundOrders[k];
    warn.push(...sh.warnings);
  }

  // ── Series (client makes it cumulative) ──
  let series: { label: string; cur: number | null; prev: number }[];
  if (granularity === "hour") {
    // Start the intraday chart at store open (the first daypart, 8AM) instead
    // of 00:00 — the pre-open hours are dead space. Any sales before open are
    // folded into the opening bucket so the running total stays accurate.
    const openH = ROUNDS[0].startH;
    const sumTo = (arr: number[], end: number) => arr.slice(0, end + 1).reduce((s, v) => s + v, 0);
    series = Array.from({ length: 24 - openH }, (_, i) => {
      const h = openH + i;
      const curSen = i === 0 ? sumTo(curHour, h) : curHour[h];
      const prevSen = i === 0 ? sumTo(prevHour, h) : prevHour[h];
      return {
        label: fmtHour(h),
        cur: curIncludesToday && h > nowHour ? null : rm(curSen),
        prev: rm(prevSen),
      };
    });
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
    .map((k) => ({ key: k, label: CHANNEL_LABELS[k], revenue: rm(chanRev[k]), orders: chanOrd[k], pct: Math.round((chanRev[k] / totalChan) * 100) }))
    .filter((c) => c.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);
  const rounds = ROUNDS.map((r) => ({ key: r.key, label: r.label, revenue: rm(roundRev[r.key] || 0), orders: roundOrd[r.key] || 0 }));
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
    outletId: scopeId,
    outletName,
    availableOutlets,
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
      appOrders: curAppOrd, appOrdersDelta: pctChange(curAppOrd, prevAppOrd),
      appSharePct: curShare, appShareDeltaPts: curShare - prevShare,
    },
    ...(warn.length ? { warnings: warn } : {}),
  });
}

// ── local types + tiny helpers ──
type PosRow = { id: string; outlet_id: string; created_at: string; subtotal: number | null; total: number | null; status: string | null; order_type: string | null; source: string | null; customer_phone: string | null; refund_of_order_id: string | null };
type AppRow = { id: string; created_at: string; subtotal: number | null; total: number | null; status: string | null; order_type: string | null; customer_phone: string | null; payment_method: string | null; table_number: string | null; source: string | null };
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

// pos_orders.outlet_id holds a POS code (outlet-sa/con/tam/nilai), not the
// Outlet UUID. Map an Outlet → its POS code via the store slug.
const SLUG_TO_POS: Record<string, string> = {
  "shah-alam": "outlet-sa", conezion: "outlet-con", tamarind: "outlet-tam", nilai: "outlet-nilai",
};
function posCodeFor(o: { pickupStoreId: string | null; name: string }): string | null {
  let slug = o.pickupStoreId;
  if (!slug) {
    const n = (o.name || "").toLowerCase();
    slug = n.includes("nilai") ? "nilai"
      : n.includes("shah") ? "shah-alam"
      : n.includes("putrajaya") || n.includes("conezion") ? "conezion"
      : n.includes("tamarind") ? "tamarind"
      : null;
  }
  return slug ? SLUG_TO_POS[slug] ?? null : null;
}
