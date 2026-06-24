/**
 * Daily rank scoreboard compute.
 *
 * Turns the geogrid KPI into one daily operating number per outlet: reviews
 * acquired per day vs the rate needed to out-review the nearest prominent
 * competitor within a target window. Reviews are the only local-rank lever
 * that moves on a daily cadence; this is its scoreboard. The weekly geogrid
 * scan remains the output confirmation.
 *
 * Reads ReviewDailySnapshot rows (populated by the daily cron) and derives
 * velocity from snapshot deltas, falling back to createTime-derived counts
 * until enough history accrues.
 */
import { prisma } from "@/lib/prisma";

const HORIZON_DAYS = 90; // window to out-review the leader

export type ScoreStatus = "ahead" | "on_track" | "behind" | "no_competitor" | "no_data";

export type ScoreRow = {
  outletId: string;
  outletName: string;
  asOf: string | null;
  reviewCount: number | null;
  averageRating: number | null;
  responseRate: number | null; // 0..1, recent
  velocity7d: number | null; // reviews/day
  velocity30d: number | null;
  competitorName: string | null;
  competitorReviews: number | null;
  gap: number | null; // competitor - us (positive = behind)
  targetPerDay: number | null; // reviews/day to overtake within HORIZON_DAYS
  status: ScoreStatus;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const daysBetween = (a: Date, b: Date) => Math.max(1, Math.round((a.getTime() - b.getTime()) / 86400000));

export async function buildScoreboard(): Promise<ScoreRow[]> {
  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      reviewDailySnapshots: { orderBy: { snapshotDate: "desc" }, take: 40 },
    },
  });

  const rows: ScoreRow[] = [];
  for (const o of outlets) {
    const snaps = o.reviewDailySnapshots;
    if (!snaps.length) {
      rows.push({
        outletId: o.id, outletName: o.name, asOf: null, reviewCount: null, averageRating: null,
        responseRate: null, velocity7d: null, velocity30d: null, competitorName: null,
        competitorReviews: null, gap: null, targetPerDay: null, status: "no_data",
      });
      continue;
    }
    type Snap = (typeof snaps)[number];
    const latest = snaps[0];
    const latestDate = new Date(latest.snapshotDate);
    const pickOlder = (n: number): Snap | null => {
      const cutoff = latestDate.getTime() - n * 86400000;
      return snaps.find((s) => new Date(s.snapshotDate).getTime() <= cutoff) ?? null;
    };
    const s7 = pickOlder(7);
    const s30 = pickOlder(30);

    const deltaVel = (older: Snap | null, fallbackCount: number, fallbackDays: number): number =>
      older
        ? Math.max(0, (latest.reviewCount - older.reviewCount) / daysBetween(latestDate, new Date(older.snapshotDate)))
        : fallbackCount / fallbackDays;

    const velocity7d = deltaVel(s7, latest.reviews7d, 7);
    const velocity30d = deltaVel(s30, latest.reviews30d, 30);
    const responseRate = latest.recentFetched > 0 ? latest.recentResponded / latest.recentFetched : null;

    const compReviews = latest.competitorReviews ?? null;
    const gap = compReviews != null ? compReviews - latest.reviewCount : null;

    // competitor's own pace, so the target accounts for them moving too
    let compVel = 0;
    if (s7 && s7.competitorReviews != null && latest.competitorReviews != null) {
      compVel = Math.max(0, (latest.competitorReviews - s7.competitorReviews) / daysBetween(latestDate, new Date(s7.snapshotDate)));
    }

    let targetPerDay: number | null = null;
    let status: ScoreStatus;
    if (gap == null) {
      status = "no_competitor";
    } else if (gap <= 0) {
      targetPerDay = compVel > 0 ? round1(compVel) : 0; // ahead: hold pace
      status = "ahead";
    } else {
      targetPerDay = round1(gap / HORIZON_DAYS + compVel);
      status = velocity7d >= targetPerDay ? "on_track" : "behind";
    }

    rows.push({
      outletId: o.id,
      outletName: o.name,
      asOf: latestDate.toISOString().slice(0, 10),
      reviewCount: latest.reviewCount,
      averageRating: latest.averageRating ?? null,
      responseRate,
      velocity7d: round1(velocity7d),
      velocity30d: round1(velocity30d),
      competitorName: latest.competitorName ?? null,
      competitorReviews: compReviews,
      gap,
      targetPerDay,
      status,
    });
  }
  return rows;
}
