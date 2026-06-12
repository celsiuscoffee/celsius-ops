// Pure aggregation logic for /api/sales/compare — extracted verbatim
// from the route so the math is unit-testable and the data layer can
// move to SQL later with a green characterization suite as the gate.
// No DB, no network: events in, period aggregates out.

import {
  ROUNDS,
  type RoundKey,
  type ChannelData,
  getMYTHour,
  getMYTDateStr,
  getRound,
  getDateRange,
  emptyChannelData,
  addToChannel,
  roundChannelData,
} from "./storehub-helpers";

export type CompareChannel = "dine_in" | "takeaway" | "delivery";

/** One normalized sale event from the unified source (any channel). */
export type CompareEvent = { ts: string; total: number; channel: CompareChannel };

export type CompareTxn = { total: number; hour: number; dateStr: string; channel: CompareChannel };

export type PeriodBucket = { from: string; to: string; txns: CompareTxn[] };

/** Bucket normalized events into the requested periods. Periods may
 *  overlap — an event lands in EVERY period that contains its MYT date
 *  (that's the point of a comparison endpoint). Bounds are inclusive. */
export function bucketEventsIntoPeriods(
  events: Iterable<CompareEvent>,
  periods: { from: string; to: string }[],
): PeriodBucket[] {
  const buckets: PeriodBucket[] = periods.map((pp) => ({ from: pp.from, to: pp.to, txns: [] }));
  for (const ev of events) {
    const dateStr = getMYTDateStr(ev.ts);
    const hour = getMYTHour(ev.ts);
    for (const bucket of buckets) {
      if (dateStr >= bucket.from && dateStr <= bucket.to) {
        bucket.txns.push({ total: ev.total, hour, dateStr, channel: ev.channel });
      }
    }
  }
  return buckets;
}

export type PeriodAggregate = {
  summary: { revenue: number; orders: number; aov: number };
  rounds: {
    key: RoundKey;
    label: string;
    revenue: number;
    orders: number;
    aov: number;
    channels: ChannelData;
  }[];
  channels: ChannelData;
  hourly: { hour: number; revenue: number; orders: number }[];
  dailyTotals: {
    date: string;
    revenue: number;
    orders: number;
    rounds: { key: RoundKey; revenue: number; orders: number }[];
  }[];
};

/** Aggregate one period bucket: summary, per-round, channel, hourly and
 *  daily breakdowns. NOTE (inherited behavior, deliberately preserved):
 *  hours outside every round (23:00–07:59 MYT) count toward summary /
 *  hourly / daily totals but appear in NO round row — the rounds table
 *  intentionally sums to less than the day. */
export function aggregatePeriod(bucket: PeriodBucket): PeriodAggregate {
  const dates = getDateRange(bucket.from, bucket.to);

  let revenue = 0;
  let orders = 0;

  const roundData = {} as Record<RoundKey, { revenue: number; orders: number; channels: ChannelData }>;
  for (const r of ROUNDS) {
    roundData[r.key] = { revenue: 0, orders: 0, channels: emptyChannelData() };
  }

  const dailyMap: Record<string, { revenue: number; orders: number }> = {};
  const dailyRoundMap: Record<string, Record<RoundKey, { revenue: number; orders: number }>> = {};
  for (const d of dates) {
    dailyMap[d] = { revenue: 0, orders: 0 };
    dailyRoundMap[d] = {} as Record<RoundKey, { revenue: number; orders: number }>;
    for (const r of ROUNDS) {
      dailyRoundMap[d][r.key] = { revenue: 0, orders: 0 };
    }
  }

  const channels = emptyChannelData();

  for (const txn of bucket.txns) {
    revenue += txn.total;
    orders += 1;

    addToChannel(channels, txn.channel, txn.total);

    if (dailyMap[txn.dateStr]) {
      dailyMap[txn.dateStr].revenue += txn.total;
      dailyMap[txn.dateStr].orders += 1;
    }

    const round = getRound(txn.hour);
    if (round && roundData[round]) {
      roundData[round].revenue += txn.total;
      roundData[round].orders += 1;
      addToChannel(roundData[round].channels, txn.channel, txn.total);

      if (dailyRoundMap[txn.dateStr]?.[round]) {
        dailyRoundMap[txn.dateStr][round].revenue += txn.total;
        dailyRoundMap[txn.dateStr][round].orders += 1;
      }
    }
  }

  // Hourly buckets (for the accumulative overlay chart). For single-day
  // periods the client renders these as a cumulative line by hour; for
  // multi-day periods it falls back to a daily cumulative line.
  const hourly = Array.from({ length: 24 }, () => ({ revenue: 0, orders: 0 }));
  for (const txn of bucket.txns) {
    if (txn.hour >= 0 && txn.hour <= 23) {
      hourly[txn.hour].revenue += txn.total;
      hourly[txn.hour].orders += 1;
    }
  }

  return {
    summary: {
      revenue: Math.round(revenue * 100) / 100,
      orders,
      aov: orders > 0 ? Math.round((revenue / orders) * 100) / 100 : 0,
    },
    rounds: ROUNDS.map((r) => {
      const rd = roundData[r.key];
      return {
        key: r.key,
        label: r.label,
        revenue: Math.round(rd.revenue * 100) / 100,
        orders: rd.orders,
        aov: rd.orders > 0 ? Math.round((rd.revenue / rd.orders) * 100) / 100 : 0,
        channels: roundChannelData(rd.channels),
      };
    }),
    channels: roundChannelData(channels),
    hourly: hourly.map((b, h) => ({
      hour: h,
      revenue: Math.round(b.revenue * 100) / 100,
      orders: b.orders,
    })),
    dailyTotals: dates.map((d) => ({
      date: d,
      revenue: Math.round((dailyMap[d]?.revenue || 0) * 100) / 100,
      orders: dailyMap[d]?.orders || 0,
      rounds: ROUNDS.map((r) => ({
        key: r.key,
        revenue: Math.round((dailyRoundMap[d]?.[r.key]?.revenue || 0) * 100) / 100,
        orders: dailyRoundMap[d]?.[r.key]?.orders || 0,
      })),
    })),
  };
}

/** "Mon 7 Apr" / "Apr 2026" / "7-13 Apr" / "28 Mar - 3 Apr" */
export function formatPeriodLabel(from: string, to: string): string {
  const f = new Date(from + "T12:00:00+08:00");
  const t = new Date(to + "T12:00:00+08:00");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  if (from === to) {
    // Single day: "Mon 7 Apr"
    return `${days[f.getDay()]} ${f.getDate()} ${months[f.getMonth()]}`;
  }

  // Check if it's a full month
  const fDate = f.getDate();
  const tDate = t.getDate();
  const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  if (fDate === 1 && tDate === lastDay && f.getMonth() === t.getMonth()) {
    return `${months[f.getMonth()]} ${f.getFullYear()}`;
  }

  // Range: "7-13 Apr" or "28 Mar - 3 Apr"
  if (f.getMonth() === t.getMonth()) {
    return `${f.getDate()}-${t.getDate()} ${months[f.getMonth()]}`;
  }
  return `${f.getDate()} ${months[f.getMonth()]} - ${t.getDate()} ${months[t.getMonth()]}`;
}
