// Settlement forecast — when does already-rung revenue actually land in the bank?
//
// Every channel pays on its own calendar, and they are not intuitive. Sales rung
// today are cash on wildly different days depending on how they were paid, so
// "what's coming in this week" was a question only answerable by hand. This
// encodes each channel's real, observed calendar and projects the booked
// pipeline forward:
//
//   QR (DuitNow)   real-time, same day, no fee
//   Card (Maybank) next business day (Conezion / Tamarind)
//   Card (NTT/GHL) ~2 business days, lumpy batches (Shah Alam / celsius)
//   Online (RM)    Mon/Tue/Wed → +2 days; Thu → Mon; Fri+Sat+Sun → the SAME
//                  following Tuesday (RM never settles on a weekend)
//   Consignment    GastroHub settles a Mon–Sun week on the following Tuesday
//
// Fees are netted so the figures are the cash that actually arrives. Grab is
// the exception to the sales-feed approach: its daily payouts pool into HQ's
// account net of a commission we don't model line-by-line, but the landings
// themselves are verified DAILY and near-flat (a payout every day of the week,
// ~RM0.6k/day, very stable). So Grab is projected straight from its trailing
// BANK run-rate — the cash that actually lands — instead of guessing a net
// factor and lag off the order feed. That also makes the panel total reconcile
// with the "Avg cash in" KPI, which is bank-based.
//
// "Booked" rows are sales already rung and awaiting settlement (firm). QR is
// same-day, so future QR is "projected" from the trailing weekday run-rate and
// labelled as such — never mixed with booked cash.

import { prisma } from "@/lib/prisma";

export type ForecastChannel = "online" | "card" | "qr" | "consignment" | "grab";
export type Basis = "booked" | "projected";

// Net-of-fee factor per channel — what fraction of gross actually lands.
const NET_FACTOR: Record<ForecastChannel, number> = {
  online: 0.98,      // ~2% Revenue Monster gateway fee
  card: 0.99,        // ~1% MDR
  qr: 1.0,           // DuitNow is free
  consignment: 0.70, // ~30% GastroHub commission
  grab: 1.0,         // projected from bank landings, already net of commission
};

// Entity ↔ bank account suffix, so each forecast row says which account it lands in.
export const ENTITY_ACCOUNT: Record<string, string> = {
  celsius: "4384",
  celsiusconezion: "2644",
  celsiustamarind: "9345",
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function parseYmd(s: string): Date { return new Date(`${s}T00:00:00Z`); }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function dow(d: Date): number { return d.getUTCDay(); } // 0 = Sunday
/** The next date strictly after `d` falling on `target` weekday. */
function nextDow(d: Date, target: number): Date {
  let x = addDays(d, 1);
  while (dow(x) !== target) x = addDays(x, 1);
  return x;
}
/** Next business day strictly after `d` (skips Sat/Sun). */
function nextBusinessDay(d: Date): Date {
  let x = addDays(d, 1);
  while (dow(x) === 0 || dow(x) === 6) x = addDays(x, 1);
  return x;
}
function addBusinessDays(d: Date, n: number): Date {
  let x = d;
  for (let i = 0; i < n; i++) x = nextBusinessDay(x);
  return x;
}

/**
 * When cash for a sale on `salesDate` lands, per channel.
 * `entity` matters for card: Maybank (Conezion/Tamarind) is next-day, while
 * Shah Alam settles through NTT/GHL in lumpy ~2-business-day batches.
 */
export function settlementDate(channel: ForecastChannel, salesDate: Date, entity: string): Date {
  switch (channel) {
    case "qr":
      return salesDate; // real-time
    case "card":
      return entity === "celsius" ? addBusinessDays(salesDate, 2) : nextBusinessDay(salesDate);
    case "online": {
      const w = dow(salesDate);
      if (w === 1 || w === 2 || w === 3) return addDays(salesDate, 2); // Mon/Tue/Wed → +2
      if (w === 4) return nextDow(salesDate, 1);                       // Thu → next Mon
      return nextDow(salesDate, 2);                                    // Fri/Sat/Sun → next Tue
    }
    case "consignment": {
      // GastroHub settles the Mon–Sun week on the following Tuesday.
      const sunday = dow(salesDate) === 0 ? salesDate : nextDow(salesDate, 0);
      return nextDow(sunday, 2);
    }
    case "grab":
      return salesDate; // daily payout — modelled as same-day run-rate
  }
}

export type ForecastRow = {
  settleDate: string;
  entity: string;
  account: string;
  channel: ForecastChannel;
  salesDate: string;
  gross: number;
  net: number;
  basis: Basis;
};

export type IncomingForecast = {
  from: string;
  to: string;
  rows: ForecastRow[];
  byDate: { date: string; net: number; booked: number; projected: number; byChannel: Partial<Record<ForecastChannel, number>> }[];
  byEntity: { entity: string; account: string; net: number }[];
  total: number;
  bookedTotal: number;
  projectedTotal: number;
  // Discounts given over the trailing window of the SAME length (ending today),
  // for context on how much revenue is being given away vs what's landing.
  // Settlement figures above are already net of discount — this is informational.
  discounts: { total: number; grossSales: number; pct: number; from: string; to: string };
  // Reconciliation against the bank's total cash-in. `grabPerDay` is already
  // folded into the channel forecast above; `otherPerDay` is the residual of
  // non-inter-company credits this forecast does NOT model (meetings/events,
  // refunds, misc), surfaced so the panel total ties out to "Avg cash in".
  reconcile: { grabPerDay: number; otherPerDay: number; otherWindowTotal: number; trailingDays: number };
};

type SalesRow = { entity: string; d: string; rm: number };

/**
 * Expected cash landing between `from` and `to` (inclusive, YYYY-MM-DD, MYT).
 *
 * Booked: sales already rung in the trailing window, mapped forward onto their
 * settlement date. Projected: QR only (same-day, so future QR cash requires
 * projecting future sales) using a trailing weekday/weekend average per outlet.
 */
export async function buildIncomingForecast(from: string, to: string): Promise<IncomingForecast> {
  const start = parseYmd(from);
  // Look back far enough that anything still unsettled is captured (the longest
  // calendar is consignment's week + Tuesday, ~10 days).
  const lookback = ymd(addDays(start, -14));

  const tenderSales = await prisma.$queryRawUnsafe<{ entity: string; d: string; method: string; rm: number }[]>(`
    SELECT fc.company_id AS entity,
           to_char((o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date,'YYYY-MM-DD') AS d,
           p.payment_method AS method,
           COALESCE(SUM(p.amount),0)::float/100 AS rm
    FROM pos_order_payments p
    JOIN pos_orders o ON o.id = p.order_id
    JOIN "Outlet" ou ON ou."loyaltyOutletId" = o.outlet_id
    JOIN fin_outlet_companies fc ON fc.outlet_id = ou.id
    WHERE o.status='completed' AND p.status='completed' AND p.payment_method IN ('card','qr')
      AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date BETWEEN $1::date AND $2::date
    GROUP BY 1,2,3
  `, lookback, to);

  const onlineSales = await prisma.$queryRawUnsafe<SalesRow[]>(`
    SELECT fc.company_id AS entity,
           to_char((ord.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date,'YYYY-MM-DD') AS d,
           COALESCE(SUM(ord.total),0)::float/100 AS rm
    FROM orders ord
    JOIN "Outlet" ou ON ou."pickupStoreId" = ord.store_id
    JOIN fin_outlet_companies fc ON fc.outlet_id = ou.id
    WHERE ord.status='completed'
      AND (ord.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date BETWEEN $1::date AND $2::date
    GROUP BY 1,2
  `, lookback, to);

  const consignSales = await prisma.$queryRawUnsafe<SalesRow[]>(`
    SELECT fc.company_id AS entity, to_char(cs.biz_date,'YYYY-MM-DD') AS d,
           COALESCE(SUM(cs.gross),0)::float AS rm
    FROM consignment_sales cs
    JOIN fin_outlet_companies fc ON fc.outlet_id = cs.outlet_id
    WHERE cs.biz_date BETWEEN $1::date AND $2::date
    GROUP BY 1,2
  `, lookback, to);

  const rows: ForecastRow[] = [];
  const push = (channel: ForecastChannel, entity: string, salesDate: string, gross: number, basis: Basis) => {
    if (gross <= 0) return;
    const settle = ymd(settlementDate(channel, parseYmd(salesDate), entity));
    if (settle < from || settle > to) return;
    rows.push({
      settleDate: settle, entity, account: ENTITY_ACCOUNT[entity] ?? "", channel,
      salesDate, gross: round2(gross), net: round2(gross * NET_FACTOR[channel]), basis,
    });
  };

  for (const r of tenderSales) push(r.method === "card" ? "card" : "qr", r.entity, r.d, Number(r.rm), "booked");
  for (const r of onlineSales) push("online", r.entity, r.d, Number(r.rm), "booked");
  for (const r of consignSales) push("consignment", r.entity, r.d, Number(r.rm), "booked");

  // Sales only exist up to today, so the far end of the horizon has no booked
  // revenue to settle. Project FUTURE sales per (entity, channel, day type) from
  // the trailing average, then run them through the same settlement calendar.
  // Projecting every channel (not just QR) keeps the horizon internally
  // consistent — otherwise the later days would show QR alone and read far too
  // low. Projected rows stay labelled so they never masquerade as booked cash.
  const todayMyt = ymd(new Date(Date.now() + 8 * 3600_000));
  const hist = new Map<string, { wd: number[]; we: number[] }>(); // key: entity|channel
  const addHist = (entity: string, channel: ForecastChannel, d: string, rm: number) => {
    const k = `${entity}|${channel}`;
    const b = hist.get(k) ?? { wd: [], we: [] };
    const w = dow(parseYmd(d));
    (w === 0 || w === 6 ? b.we : b.wd).push(rm);
    hist.set(k, b);
  };
  for (const r of tenderSales) addHist(r.entity, r.method === "card" ? "card" : "qr", r.d, Number(r.rm));
  for (const r of onlineSales) addHist(r.entity, "online", r.d, Number(r.rm));
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

  // Project sales for every future day whose settlement could land inside the
  // window (settlement is never earlier than the sale, so `to` is the far edge).
  for (let d = addDays(parseYmd(todayMyt), 1); ymd(d) <= to; d = addDays(d, 1)) {
    const day = ymd(d);
    const weekend = dow(d) === 0 || dow(d) === 6;
    for (const [k, b] of hist) {
      const [entity, channel] = k.split("|") as [string, ForecastChannel];
      const avg = mean(weekend ? b.we : b.wd);
      if (avg > 0) push(channel, entity, day, avg, "projected");
    }
  }

  // Grab + residual credits, from the trailing BANK run-rate (see file header).
  // Grab lands daily and near-flat, so a flat per-day figure across the window
  // is a faithful estimate; `otherPerDay` (meetings/refunds/misc) is not placed
  // on the calendar — it feeds the reconciliation footnote only.
  const trailingDays = 28;
  const bankFrom = ymd(addDays(parseYmd(todayMyt), -trailingDays));
  const bankRows = await prisma.$queryRawUnsafe<{ grab_per_day: number; other_per_day: number }[]>(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE category::text IN ('GRAB','GRAB_PUTRAJAYA')),0)::float / ${trailingDays} AS grab_per_day,
      COALESCE(SUM(amount) FILTER (WHERE category::text NOT IN ('CARD','REVENUE_MONSTER','QR','GRAB','GRAB_PUTRAJAYA','GASTROHUB')),0)::float / ${trailingDays} AS other_per_day
    FROM "BankStatementLine"
    WHERE direction='CR' AND "isInterCo" = false
      AND ("txnDate" + interval '8 hours')::date >= $1::date
      AND ("txnDate" + interval '8 hours')::date <  $2::date
  `, bankFrom, todayMyt);
  const grabPerDay = round2(Number(bankRows[0]?.grab_per_day ?? 0));
  const otherPerDay = round2(Number(bankRows[0]?.other_per_day ?? 0));

  // Grab pools into HQ's account (4384 = celsius). Place the run-rate on every
  // day of the window — it settles same-day so nothing spills past the edge.
  if (grabPerDay > 0) {
    for (let d = parseYmd(from); ymd(d) <= to; d = addDays(d, 1)) {
      push("grab", "celsius", ymd(d), grabPerDay, "projected");
    }
  }

  // Aggregate
  const byDateMap = new Map<string, { net: number; booked: number; projected: number; byChannel: Partial<Record<ForecastChannel, number>> }>();
  const byEntityMap = new Map<string, number>();
  for (const r of rows) {
    const e = byDateMap.get(r.settleDate) ?? { net: 0, booked: 0, projected: 0, byChannel: {} };
    e.net = round2(e.net + r.net);
    if (r.basis === "booked") e.booked = round2(e.booked + r.net); else e.projected = round2(e.projected + r.net);
    e.byChannel[r.channel] = round2((e.byChannel[r.channel] ?? 0) + r.net);
    byDateMap.set(r.settleDate, e);
    byEntityMap.set(r.entity, round2((byEntityMap.get(r.entity) ?? 0) + r.net));
  }
  const byDate = [...byDateMap.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
  const byEntity = [...byEntityMap.entries()].map(([entity, net]) => ({ entity, account: ENTITY_ACCOUNT[entity] ?? "", net })).sort((a, b) => b.net - a.net);
  const bookedTotal = round2(rows.filter((r) => r.basis === "booked").reduce((s, r) => s + r.net, 0));
  const projectedTotal = round2(rows.filter((r) => r.basis === "projected").reduce((s, r) => s + r.net, 0));

  // Discounts given over the trailing window of the same length, ending today.
  // Settlement figures are already net of discount; this is context only.
  const windowDays = Math.max(1, Math.round((parseYmd(to).getTime() - start.getTime()) / 86400_000) + 1);
  const discFrom = ymd(addDays(parseYmd(from), -windowDays));
  const discTo = ymd(addDays(parseYmd(from), -1));
  const discRows = await prisma.$queryRawUnsafe<{ discount: number; gross: number }[]>(`
    SELECT COALESCE(SUM(discount),0)::float AS discount, COALESCE(SUM(gross),0)::float AS gross
    FROM unified_sales WHERE biz_date BETWEEN $1::date AND $2::date
  `, discFrom, discTo);
  const discTotal = round2(Number(discRows[0]?.discount ?? 0));
  const grossSales = round2(Number(discRows[0]?.gross ?? 0));
  const discounts = {
    total: discTotal,
    grossSales,
    pct: grossSales > 0 ? round2((discTotal / grossSales) * 100) : 0,
    from: discFrom,
    to: discTo,
  };

  const reconcile = {
    grabPerDay,
    otherPerDay,
    otherWindowTotal: round2(otherPerDay * windowDays),
    trailingDays,
  };

  return { from, to, rows, byDate, byEntity, total: round2(bookedTotal + projectedTotal), bookedTotal, projectedTotal, discounts, reconcile };
}
