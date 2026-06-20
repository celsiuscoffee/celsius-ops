import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";
import { Prisma } from "@prisma/client";
import {
  type Mode, type ChannelKey, type PayKey, type RoundKey,
  rangesForMode, getMYTToday, getMYTHourNow, getMYTDateStr, getMYTHour, getRound,
  mytDayStartUTC, mytDayEndUTC, addDays,
  ROUNDS, CHANNEL_LABELS, PAY_LABELS,
  classifyPosChannel, classifyAppChannel, normalizePayment,
  isPosSale, isAppSale, rm, round2, pctChange,
} from "../_lib/sales-helpers";
import { getStorehubFromDB } from "../_lib/storehub-bridge";

// GET /api/sales/dashboard?mode=day|week|month|custom&from=&to=&outletId=
// Consolidated native POS (pos_orders + pos_order_payments) + pickup (orders).
// Auth: getSession (cookie for web staff, Bearer for native staff).

// Always recompute — never serve a cached body. The native app's HTTP layer
// (esp. iOS NSURLCache) would otherwise heuristically cache this GET and show a
// frozen "to-date" total long after sales have moved on.
export const dynamic = "force-dynamic";

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
  let scopeOutlets: { id: string; storehubId: string | null; posCode: string | null; cutoverAt: Date | null }[] = [];

  if (isAdmin) {
    const all = await prisma.outlet.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, pickupStoreId: true, storehubId: true, posNativeCutoverAt: true },
      orderBy: { name: "asc" },
    });
    availableOutlets = all.map((o) => ({ id: o.id, name: o.name }));
    const pick = scope === "all" ? all : all.filter((x) => x.id === scope);
    if (scope !== "all" && pick.length === 0) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
    scopeOutlets = pick.map((o) => ({ id: o.id, storehubId: o.storehubId, posCode: posCodeFor(o), cutoverAt: o.posNativeCutoverAt }));
    storeIds = pick.map((o) => o.pickupStoreId).filter((s): s is string => !!s);
    outletName = scope === "all" ? "All outlets" : pick[0].name;
    scopeId = scope === "all" ? "all" : pick[0].id;
  } else {
    const o = await prisma.outlet.findUnique({
      where: { id: scope },
      select: { id: true, name: true, pickupStoreId: true, storehubId: true, posNativeCutoverAt: true },
    });
    if (!o) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
    scopeOutlets = [{ id: o.id, storehubId: o.storehubId, posCode: posCodeFor(o), cutoverAt: o.posNativeCutoverAt }];
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

  // pos_orders + pickup orders via RAW SQL — NOT the Supabase REST client.
  // PostgREST is capped at ~1000 rows on this project (the server `max-rows`
  // setting), so `.limit(20000)` was silently ignored: a wide window (this
  // period carries ~1.5k native orders) came back truncated to the OLDEST
  // ~1000, dropping the most RECENT orders and undercounting the headline by
  // the latest day or two. The StoreHub bridge was already moved off PostgREST
  // for this exact reason; the till/app queries hadn't been.
  const warn: string[] = [];
  const winStartD = new Date(winStart);
  const winEndD = new Date(winEnd);

  const [posRows, appRows, priorRes] = await Promise.all([
    posCodes.length
      ? prisma
          .$queryRaw<Array<Omit<PosRow, "created_at"> & { created_at: Date }>>`
            SELECT id, outlet_id, created_at, subtotal, total, status, order_type, source, customer_phone, refund_of_order_id
            FROM pos_orders
            WHERE outlet_id IN (${Prisma.join(posCodes)})
              AND created_at >= ${winStartD} AND created_at <= ${winEndD}
          `
          .then((rows) =>
            rows.map((r): PosRow => ({
              ...r,
              created_at: r.created_at.toISOString(),
              subtotal: r.subtotal == null ? null : Number(r.subtotal),
              total: r.total == null ? null : Number(r.total),
            })),
          )
          .catch((e: unknown) => {
            warn.push(`pos_orders: ${e instanceof Error ? e.message : "query failed"}`);
            return [] as PosRow[];
          })
      : Promise.resolve([] as PosRow[]),
    storeIds.length
      ? prisma
          .$queryRaw<Array<Omit<AppRow, "created_at"> & { created_at: Date }>>`
            SELECT id, created_at, subtotal, total, status, order_type, customer_phone, payment_method, table_number, source
            FROM orders
            WHERE store_id IN (${Prisma.join(storeIds)})
              AND created_at >= ${winStartD} AND created_at <= ${winEndD}
          `
          .then((rows) =>
            rows.map((r): AppRow => ({
              ...r,
              created_at: r.created_at.toISOString(),
              subtotal: r.subtotal == null ? null : Number(r.subtotal),
              total: r.total == null ? null : Number(r.total),
            })),
          )
          .catch((e: unknown) => {
            warn.push(`orders: ${e instanceof Error ? e.message : "query failed"}`);
            return [] as AppRow[];
          })
      : Promise.resolve([] as AppRow[]),
    // Distinct prior phones via RPC — deduped in SQL (count-style, not row-capped).
    supabaseAdmin.rpc("prior_customer_phones", {
      p_before: priorCut,
      p_pos_codes: posCodes,
      p_store_ids: storeIds,
    }),
  ]);

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
  // as a target); only the summary deltas use this cutoff. StoreHub-sourced
  // rows follow the same rule (prevCutoffMs is passed to getStorehubFromDB).
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
  let curAppNative = 0, curAppWeb = 0; // app-order split by origin (orders.source)
  let curCapOrd = 0, prevCapOrd = 0; // orders with a customer phone (points captured)
  let curPosCap = 0, curAppNativeCap = 0, curAppWebCap = 0; // captured, per channel
  const curPosIds: string[] = [];
  const nativeCodes = new Set<string>(); // pos outlet-codes with native sales this period

  const inCur = (d: string) => d >= cur.from && d <= cur.to;
  const inPrev = (d: string) => d >= prev.from && d <= prev.to;

  for (const r of posRows) {
    if (!isPosSale(r.status, r.refund_of_order_id)) continue;
    const d = getMYTDateStr(r.created_at);
    // Revenue basis = `total` (net of discounts — what was actually collected),
    // matching the backoffice sales module. `subtotal` is the pre-discount
    // gross and over-counts by the discount amount.
    const net = r.total || 0;
    // Headline revenue / orders / series / breakdowns count COMPLETED sales
    // only, exactly like backoffice — so the totals reconcile across apps.
    // Capture (phones), growth order-splits, payments and native-outlet
    // detection keep the broader isPosSale base (live operational signal).
    const counts = (r.status || "").toLowerCase() === "completed";
    if (inCur(d)) {
      nativeCodes.add(r.outlet_id);
      if (r.customer_phone) { curPhones.add(r.customer_phone); curCapOrd++; curPosCap++; }
      curPosOrd++;
      curPosIds.push(r.id);
      if (counts) {
        curRev += net; curOrd++;
        curByDate[d] = (curByDate[d] || 0) + net;
        curHour[getMYTHour(r.created_at)] += net;
        const pch = classifyPosChannel(r.order_type, r.source); chanRev[pch] += net; chanOrd[pch]++;
        const rd = getRound(getMYTHour(r.created_at)); if (rd) { roundRev[rd] += net; roundOrd[rd]++; }
      }
    } else if (inPrev(d)) {
      if (r.customer_phone) prevPhones.add(r.customer_phone);
      if (Date.parse(r.created_at) <= prevCutoffMs) {
        prevPosOrd++; if (r.customer_phone) prevCapOrd++;
        if (counts) { prevRev += net; prevOrd++; }
      }
      if (counts) {
        prevByDate[d] = (prevByDate[d] || 0) + net;
        prevHour[getMYTHour(r.created_at)] += net;
      }
    }
  }
  for (const r of appRows) {
    if (!isAppSale(r.status)) continue;
    const d = getMYTDateStr(r.created_at);
    // Same as the POS loop: net `total`, and only COMPLETED orders count toward
    // revenue/series/breakdowns (pickup/app orders sit in paid/preparing/ready
    // before completion — backoffice waits for completed, so we do too). Phone
    // capture + growth splits keep the broader isAppSale base.
    const net = r.total || 0;
    const counts = (r.status || "").toLowerCase() === "completed";
    if (inCur(d)) {
      curAppOrd++;
      // Native = the iOS/Android binary (orders.source app_ios|app_android);
      // everything else (web, web_qr table, legacy null) counts as Web.
      const appNative = r.source === "app_ios" || r.source === "app_android";
      if (appNative) curAppNative++; else curAppWeb++;
      if (r.customer_phone) {
        curPhones.add(r.customer_phone); curAppPhones.add(r.customer_phone); curCapOrd++;
        if (appNative) curAppNativeCap++; else curAppWebCap++;
      }
      if (counts) {
        curRev += net; curOrd++;
        curByDate[d] = (curByDate[d] || 0) + net;
        curHour[getMYTHour(r.created_at)] += net;
        const ach = classifyAppChannel(r.order_type, r.table_number, r.source); chanRev[ach] += net; chanOrd[ach]++;
        const rd = getRound(getMYTHour(r.created_at)); if (rd) { roundRev[rd] += net; roundOrd[rd]++; }
        const pk = normalizePayment(r.payment_method);
        payAmt[pk] = (payAmt[pk] || 0) + (r.total || 0);
      }
    } else if (inPrev(d)) {
      if (r.customer_phone) { prevPhones.add(r.customer_phone); prevAppPhones.add(r.customer_phone); }
      if (Date.parse(r.created_at) <= prevCutoffMs) {
        prevAppOrd++; if (r.customer_phone) prevCapOrd++;
        if (counts) { prevRev += net; prevOrd++; }
      }
      if (counts) {
        prevByDate[d] = (prevByDate[d] || 0) + net;
        prevHour[getMYTHour(r.created_at)] += net;
      }
    }
  }

  // ── POS payment split (current period) ──
  if (curPosIds.length) {
    // Raw SQL again — PostgREST's ~1000-row cap would otherwise truncate the
    // payment split for a busy period (curPosIds can be well over 1000).
    const payRows = await prisma
      .$queryRaw<PayRow[]>`
        SELECT order_id, payment_method, amount, refund_amount
        FROM pos_order_payments
        WHERE order_id IN (${Prisma.join(curPosIds)})
      `
      .catch((e: unknown) => {
        warn.push(`pos_order_payments: ${e instanceof Error ? e.message : "query failed"}`);
        return [] as PayRow[];
      });
    for (const p of payRows) {
      const pk = normalizePayment(p.payment_method);
      payAmt[pk] = (payAmt[pk] || 0) + ((Number(p.amount) || 0) - (Number(p.refund_amount) || 0));
    }
  }

  // ── StoreHub (transition mode) — merge from the backoffice sales module ──
  // Sum StoreHub + native for ANY outlet that still has a storehubId. A sale
  // rings in exactly one system (StoreHub OR the new POS), so summing both is
  // correct (no double-count) and captures both sides of a transitioning day.
  const shScope = scopeOutlets.filter((o) => o.storehubId);
  console.warn(`[sales] codes=[${posCodes.join(",")}] native=[${[...nativeCodes].join(",")}] shScope=[${shScope.map((o) => o.id).join(",")}] authz=${req.headers.get("authorization") ? "y" : "n"}`);
  if (shScope.length) {
    const sh = await getStorehubFromDB({
      outlets: shScope,
      cur,
      prev,
      granularity,
      prevCutoffMs,
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
  const priorAll = new Set<string>(), priorApp = new Set<string>();
  for (const r of (priorRes.data || []) as { phone: string; app_customer: boolean }[]) {
    priorAll.add(r.phone);
    if (r.app_customer) priorApp.add(r.phone);
  }

  // new = first seen within the period (not before its start)
  const newCustomers = [...curPhones].filter((p) => !priorAll.has(p) && !prevPhones.has(p)).length;
  const prevNewCustomers = [...prevPhones].filter((p) => !priorAll.has(p)).length;
  const newAppCustomers = [...curAppPhones].filter((p) => !priorApp.has(p) && !prevAppPhones.has(p)).length;
  const prevNewApp = [...prevAppPhones].filter((p) => !priorApp.has(p)).length;
  // Pair adds (upsell) — pairs that actually CHECKED OUT, split 3 ways:
  //   In-store  → pos_pair_events stamped with an order_id at payment
  //               (stampPairOrder). Unstamped rows are add-to-cart taps that
  //               never converted, so they're excluded.
  //   Native    → order_items.is_pair lines on app orders from app_ios/android.
  //   Web       → order_items.is_pair lines on app orders from the web PWA.
  // Prev side clipped to the same elapsed time (like-for-like).
  const prevPairEnd = Number.isFinite(prevCutoffMs)
    ? new Date(Math.min(prevCutoffMs, Date.parse(mytDayEndUTC(prev.to)))).toISOString()
    : mytDayEndUTC(prev.to);

  // ── In-store (POS) — count-only queries (head:true), immune to the row cap.
  let curPairInstore = 0, prevPairInstore = 0;
  if (posCodes.length) {
    const [pc, pp] = await Promise.all([
      supabaseAdmin.from("pos_pair_events").select("id", { count: "exact", head: true })
        .in("outlet_id", posCodes).not("order_id", "is", null)
        .gte("created_at", mytDayStartUTC(cur.from)).lte("created_at", mytDayEndUTC(cur.to)),
      supabaseAdmin.from("pos_pair_events").select("id", { count: "exact", head: true })
        .in("outlet_id", posCodes).not("order_id", "is", null)
        .gte("created_at", mytDayStartUTC(prev.from)).lte("created_at", prevPairEnd),
    ]);
    if (pc.error) warn.push(`pos_pair_events: ${pc.error.message}`); else curPairInstore = pc.count || 0;
    if (pp.error) warn.push(`pos_pair_events(prev): ${pp.error.message}`); else prevPairInstore = pp.count || 0;
  }

  // ── Pickup app (native vs web) — one is_pair line = one purchased pair.
  // Forward-only: is_pair is false for orders placed before this shipped.
  let curPairNative = 0, curPairWeb = 0, prevPairNative = 0, prevPairWeb = 0;
  if (storeIds.length) {
    type PairRow = { source: string | null; status: string | null; created_at: Date };
    const pairRows = await prisma
      .$queryRaw<PairRow[]>`
        SELECT o.source, o.status, o.created_at
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.store_id IN (${Prisma.join(storeIds)})
          AND o.created_at >= ${winStartD} AND o.created_at <= ${winEndD}
          AND oi.is_pair = true
      `
      .catch((e: unknown) => {
        warn.push(`order_items(pair): ${e instanceof Error ? e.message : "query failed"}`);
        return [] as PairRow[];
      });
    for (const r of pairRows) {
      if (!isAppSale(r.status)) continue;
      const ts = r.created_at.toISOString();
      const d = getMYTDateStr(ts);
      const isNative = r.source === "app_ios" || r.source === "app_android";
      if (inCur(d)) {
        if (isNative) curPairNative++; else curPairWeb++;
      } else if (inPrev(d) && Date.parse(ts) <= prevCutoffMs) {
        if (isNative) prevPairNative++; else prevPairWeb++;
      }
    }
  }

  const curPair = curPairInstore + curPairNative + curPairWeb;
  const prevPair = prevPairInstore + prevPairNative + prevPairWeb;

  const curShare = curOrd ? Math.round((curAppOrd / curOrd) * 100) : 0;
  const prevShare = prevOrd ? Math.round((prevAppOrd / prevOrd) * 100) : 0;
  // Collection rate = orders where a customer phone was captured / NATIVE orders
  // (pos + pickup). StoreHub rows have no customer data, so they're excluded
  // from both sides — otherwise still-on-StoreHub outlets would read ~0%.
  const curNativeOrd = curPosOrd + curAppOrd;
  const prevNativeOrd = prevPosOrd + prevAppOrd;
  const curCapRate = curNativeOrd ? Math.round((curCapOrd / curNativeOrd) * 100) : 0;
  const prevCapRate = prevNativeOrd ? Math.round((prevCapOrd / prevNativeOrd) * 100) : 0;
  // Same capture rate, split by channel: each channel's captured orders over its
  // own order count (in-store POS, native app, web/PWA).
  const curCapRatePos = curPosOrd ? Math.round((curPosCap / curPosOrd) * 100) : 0;
  const curCapRateNative = curAppNative ? Math.round((curAppNativeCap / curAppNative) * 100) : 0;
  const curCapRateWeb = curAppWeb ? Math.round((curAppWebCap / curAppWeb) * 100) : 0;

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
      appOrdersNative: curAppNative, appOrdersWeb: curAppWeb,
      appSharePct: curShare, appShareDeltaPts: curShare - prevShare,
      capturedOrders: curCapOrd, collectionRatePct: curCapRate,
      collectionDeltaPts: curCapRate - prevCapRate,
      collectionRatePos: curCapRatePos, collectionRateNative: curCapRateNative, collectionRateWeb: curCapRateWeb,
      capturedPos: curPosCap, capturedNative: curAppNativeCap, capturedWeb: curAppWebCap,
      pairAdds: curPair, pairAddsDelta: pctChange(curPair, prevPair),
      pairInstore: curPairInstore, pairNative: curPairNative, pairWeb: curPairWeb,
    },
    ...(warn.length ? { warnings: warn } : {}),
  }, { headers: { "Cache-Control": "no-store, must-revalidate" } });
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
