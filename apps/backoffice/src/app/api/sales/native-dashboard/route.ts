import { NextRequest, NextResponse } from "next/server";
import { getSession, verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase-server";
import {
  type Mode, type ChannelKey, type PayKey,
  rangesForMode, getMYTToday, getMYTHourNow, getMYTDateStr, getMYTHour, getRound,
  mytDayStartUTC, mytDayEndUTC, addDays,
  ROUNDS, CHANNEL_LABELS, PAY_LABELS,
  normalizePayment, isPosSale, isAppSale, rm, round2, pctChange,
} from "../_lib/native-sales-helpers";
import { getUnifiedSalesForOutlet } from "../_lib/unified-sales";

// GET /api/sales/native-dashboard?mode=day|week|month|custom&from=&to=&outletId=
//
// The staff-native SalesDashboard, served straight from the backoffice — NO
// cross-app bridge. Sales totals / series / channels / rounds come from the
// unified reader (StoreHub archive + live-today, POS-native, pickup — already
// cutover-routed, no double-count). Payments + growth come from the native
// pos/pickup tables (StoreHub exposes neither), same as the old staff route.
//
// Auth: cookie session (BO web) OR Bearer (native staff). The native token
// validates here once both Vercel projects share JWT_SECRET (migration Phase 0).
export async function GET(req: NextRequest) {
  let user = await getSession();
  if (!user) {
    const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
    if (m) user = await verifyToken(m[1]);
  }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const mode = (sp.get("mode") || "day") as Mode;
  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
  const reqOutlet = sp.get("outletId");
  // Admins default to "all" and may drill into one outlet; everyone else is
  // locked to their assigned outlet (client param ignored).
  const scope = isAdmin ? (reqOutlet || "all") : user.outletId;
  if (!scope) return NextResponse.json({ error: "No outlet" }, { status: 400 });

  const all = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true, name: true, storehubId: true,
      loyaltyOutletId: true, pickupStoreId: true, posNativeCutoverAt: true,
    },
    orderBy: { name: "asc" },
  });
  const pick = scope === "all" ? all : all.filter((o) => o.id === scope);
  if (scope !== "all" && pick.length === 0) {
    return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
  }
  const outletName = scope === "all" ? "All outlets" : pick[0].name;
  const scopeId = scope === "all" ? "all" : pick[0].id;

  const { cur, prev, granularity } = rangesForMode(mode, sp.get("from"), sp.get("to"));
  const today = getMYTToday();
  const nowHour = getMYTHourNow();
  const curIncludesToday = cur.to >= today;

  const supabase = await createClient();
  const winStart = mytDayStartUTC(prev.from);
  const winEnd = mytDayEndUTC(cur.to);
  const priorCut = mytDayStartUTC(prev.from);

  // ── Sales: unified source (StoreHub + POS + pickup), one call per outlet ──
  const unifiedResults = await Promise.allSettled(
    pick.map((o) =>
      getUnifiedSalesForOutlet(
        {
          outletId: o.id,
          storehubStoreId: o.storehubId,
          loyaltyOutletId: o.loyaltyOutletId,
          pickupStoreId: o.pickupStoreId,
          cutoverAt: o.posNativeCutoverAt,
        },
        new Date(`${prev.from}T00:00:00+08:00`),
        new Date(`${cur.to}T23:59:59+08:00`),
        {}, // full unified (not storehub-only)
      ),
    ),
  );

  const warn: string[] = [];
  const unified: { ts: string; total: number; channel: "dine_in" | "takeaway" | "delivery" }[] = [];
  for (const r of unifiedResults) {
    if (r.status === "rejected") {
      warn.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      continue;
    }
    for (const ev of r.value) unified.push({ ts: ev.ts, total: ev.total, channel: ev.channel });
  }

  const inCur = (d: string) => d >= cur.from && d <= cur.to;
  const inPrev = (d: string) => d >= prev.from && d <= prev.to;
  // Like-for-like: while the current period is in progress, clip the previous
  // period's summary total to the same elapsed point (today-so-far vs
  // yesterday-to-the-same-time). The chart's previous line stays full.
  const prevCutoffMs = curIncludesToday
    ? Date.parse(mytDayStartUTC(prev.from)) + (Date.now() - Date.parse(mytDayStartUTC(cur.from)))
    : Number.POSITIVE_INFINITY;

  const curDates = dateRange(cur.from, cur.to);
  const prevDates = dateRange(prev.from, prev.to);
  const curHour = Array.from({ length: 24 }, () => 0);
  const prevHour = Array.from({ length: 24 }, () => 0);
  const curByDate: Record<string, number> = {};
  const prevByDate: Record<string, number> = {};
  for (const d of curDates) curByDate[d] = 0;
  for (const d of prevDates) prevByDate[d] = 0;
  let curRev = 0, curOrd = 0, prevRev = 0, prevOrd = 0;
  const chanRev: Record<string, number> = { dine_in: 0, takeaway: 0, delivery: 0 };
  const chanOrd: Record<string, number> = { dine_in: 0, takeaway: 0, delivery: 0 };
  const roundRev: Record<string, number> = {};
  const roundOrd: Record<string, number> = {};
  for (const r of ROUNDS) { roundRev[r.key] = 0; roundOrd[r.key] = 0; }

  for (const ev of unified) {
    const d = getMYTDateStr(ev.ts);
    const h = getMYTHour(ev.ts);
    const net = ev.total; // RM
    if (inCur(d)) {
      curRev += net; curOrd++;
      curByDate[d] = (curByDate[d] || 0) + net;
      curHour[h] += net;
      chanRev[ev.channel] += net; chanOrd[ev.channel]++;
      const rd = getRound(h); if (rd) { roundRev[rd] += net; roundOrd[rd]++; }
    } else if (inPrev(d)) {
      if (Date.parse(ev.ts) <= prevCutoffMs) { prevRev += net; prevOrd++; }
      prevByDate[d] = (prevByDate[d] || 0) + net;
      prevHour[h] += net;
    }
  }

  // ── Series (client renders the running total) ──
  let series: { label: string; cur: number | null; prev: number }[];
  if (granularity === "hour") {
    series = Array.from({ length: 24 }, (_, h) => ({
      label: fmtHour(h),
      cur: curIncludesToday && h > nowHour ? null : round2(curHour[h]),
      prev: round2(prevHour[h]),
    }));
  } else {
    series = curDates.map((d, i) => {
      const pd = prevDates[i];
      return {
        label: mode === "week" ? WK[new Date(`${d}T12:00:00+08:00`).getDay()] : fmtDayMon(d),
        cur: d > today ? null : round2(curByDate[d] || 0),
        prev: pd != null ? round2(prevByDate[pd] || 0) : 0,
      };
    });
  }

  // ── Channels / rounds ──
  const totalChan = Object.values(chanRev).reduce((s, v) => s + v, 0) || 1;
  const channels = (["dine_in", "takeaway", "delivery"] as ChannelKey[])
    .map((k) => ({ key: k, label: CHANNEL_LABELS[k], revenue: round2(chanRev[k]), orders: chanOrd[k], pct: Math.round((chanRev[k] / totalChan) * 100) }))
    .filter((c) => c.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);
  const rounds = ROUNDS.map((r) => ({ key: r.key, label: r.label, revenue: round2(roundRev[r.key] || 0), orders: roundOrd[r.key] || 0 }));

  // ── Payments + growth: native pos/pickup only (StoreHub has neither) ──
  const posCodes = pick.map((o) => posCodeFor(o)).filter((c): c is string => !!c);
  const storeIds = pick.map((o) => o.pickupStoreId).filter((s): s is string => !!s);

  const [posRes, appRes, posPriorRes, appPriorRes] = await Promise.all([
    posCodes.length
      ? supabase.from("pos_orders").select("id, created_at, status, refund_of_order_id, customer_phone")
          .in("outlet_id", posCodes).gte("created_at", winStart).lte("created_at", winEnd).limit(20000)
      : Promise.resolve({ data: [], error: null }),
    storeIds.length
      ? supabase.from("orders").select("id, created_at, status, total, customer_phone, payment_method")
          .in("store_id", storeIds).gte("created_at", winStart).lte("created_at", winEnd).limit(20000)
      : Promise.resolve({ data: [], error: null }),
    posCodes.length
      ? supabase.from("pos_orders").select("customer_phone")
          .in("outlet_id", posCodes).lt("created_at", priorCut).not("customer_phone", "is", null).limit(50000)
      : Promise.resolve({ data: [], error: null }),
    storeIds.length
      ? supabase.from("orders").select("customer_phone")
          .in("store_id", storeIds).lt("created_at", priorCut).not("customer_phone", "is", null).limit(50000)
      : Promise.resolve({ data: [], error: null }),
  ]);

  type PosRow = { id: string; created_at: string; status: string | null; refund_of_order_id: string | null; customer_phone: string | null };
  type AppRow = { id: string; created_at: string; status: string | null; total: number | null; customer_phone: string | null; payment_method: string | null };
  const curPhones = new Set<string>(), prevPhones = new Set<string>();
  const curAppPhones = new Set<string>(), prevAppPhones = new Set<string>();
  let curAppOrd = 0, prevAppOrd = 0;
  const curPosIds: string[] = [];
  const payAmt: Record<string, number> = {}; // SEN

  for (const r of (posRes.data || []) as PosRow[]) {
    if (!isPosSale(r.status, r.refund_of_order_id)) continue;
    const d = getMYTDateStr(r.created_at);
    if (inCur(d)) { if (r.customer_phone) curPhones.add(r.customer_phone); curPosIds.push(r.id); }
    else if (inPrev(d)) { if (r.customer_phone) prevPhones.add(r.customer_phone); }
  }
  for (const r of (appRes.data || []) as AppRow[]) {
    if (!isAppSale(r.status)) continue;
    const d = getMYTDateStr(r.created_at);
    if (inCur(d)) {
      curAppOrd++;
      if (r.customer_phone) { curPhones.add(r.customer_phone); curAppPhones.add(r.customer_phone); }
      const pk = normalizePayment(r.payment_method);
      payAmt[pk] = (payAmt[pk] || 0) + (r.total || 0);
    } else if (inPrev(d)) {
      prevAppOrd++;
      if (r.customer_phone) { prevPhones.add(r.customer_phone); prevAppPhones.add(r.customer_phone); }
    }
  }

  if (curPosIds.length) {
    const payRes = await supabase.from("pos_order_payments")
      .select("payment_method, amount, refund_amount")
      .in("order_id", curPosIds.slice(0, 5000)).limit(20000);
    if (payRes.error) warn.push(`pos_order_payments: ${payRes.error.message}`);
    type PayRow = { payment_method: string | null; amount: number | null; refund_amount: number | null };
    for (const p of (payRes.data || []) as PayRow[]) {
      const pk = normalizePayment(p.payment_method);
      payAmt[pk] = (payAmt[pk] || 0) + ((p.amount || 0) - (p.refund_amount || 0));
    }
  }

  const priorAll = new Set<string>(), priorApp = new Set<string>();
  for (const r of (posPriorRes.data || []) as { customer_phone: string | null }[]) if (r.customer_phone) priorAll.add(r.customer_phone);
  for (const r of (appPriorRes.data || []) as { customer_phone: string | null }[]) if (r.customer_phone) { priorAll.add(r.customer_phone); priorApp.add(r.customer_phone); }

  const newCustomers = [...curPhones].filter((p) => !priorAll.has(p) && !prevPhones.has(p)).length;
  const prevNewCustomers = [...prevPhones].filter((p) => !priorAll.has(p)).length;
  const newAppCustomers = [...curAppPhones].filter((p) => !priorApp.has(p) && !prevAppPhones.has(p)).length;
  const prevNewApp = [...prevAppPhones].filter((p) => !priorApp.has(p)).length;
  const curShare = curOrd ? Math.round((curAppOrd / curOrd) * 100) : 0;
  const prevShare = prevOrd ? Math.round((prevAppOrd / prevOrd) * 100) : 0;

  const totalPay = Object.values(payAmt).reduce((s, v) => s + v, 0) || 1;
  const payments = (Object.keys(payAmt) as PayKey[])
    .map((k) => ({ key: k, label: PAY_LABELS[k] ?? k, amount: rm(payAmt[k]), pct: Math.round((payAmt[k] / totalPay) * 100) }))
    .filter((p) => p.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  return NextResponse.json({
    outletId: scopeId,
    outletName,
    availableOutlets: isAdmin ? all.map((o) => ({ id: o.id, name: o.name })) : undefined,
    mode,
    granularity,
    cur: { ...cur, label: labelFor(mode, "cur") },
    prev: { ...prev, label: labelFor(mode, "prev") },
    summary: {
      revenue: round2(curRev), orders: curOrd, aov: curOrd ? round2(curRev / curOrd) : 0,
      prevRevenue: round2(prevRev), prevOrders: prevOrd, prevAov: prevOrd ? round2(prevRev / prevOrd) : 0,
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

// ── local helpers ──
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
// pos_orders.outlet_id holds a POS code (outlet-sa/con/tam/nilai), not the UUID.
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
