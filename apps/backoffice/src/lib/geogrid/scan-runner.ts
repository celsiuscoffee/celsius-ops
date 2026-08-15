/**
 * Shared geogrid scan orchestration (used by the manual route + the auto cron)
 * and the adaptive cadence logic that decides when each keyword×outlet is due.
 */
import { prisma } from "@/lib/prisma";
import { getLocationGeo } from "@/lib/reviews/gbp";
import { buildGrid, scanGrid, computeMetrics } from "@/lib/geogrid/places";
import type { GeoGridScan } from "@prisma/client";

const METERS_PER_MILE = 1609.34;

export class GeoScanError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Resolve the outlet centre + target, run the grid, store the scan. */
export async function runScan(opts: {
  outletId: string;
  keyword: string;
  gridSize: number;
  rangeMiles: number;
  apiKey: string;
  createdBy?: string;
}): Promise<{ scan: GeoGridScan; failures: number; sampleError: string | null; retries: number }> {
  const { outletId, keyword, gridSize, rangeMiles, apiKey, createdBy } = opts;

  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    include: { reviewSettings: true },
  });
  if (!outlet?.reviewSettings?.gbpLocationName) {
    throw new GeoScanError("Outlet has no GBP location connected");
  }

  // GBP doesn't always expose latlng — fall back to the outlet's own coords,
  // and to the outlet name for matching when there's no Place id.
  let geo: { lat: number | null; lng: number | null; placeId: string | null; title: string | null } = {
    lat: null, lng: null, placeId: null, title: null,
  };
  try {
    geo = await getLocationGeo(outlet.reviewSettings.gbpLocationName);
  } catch (err) {
    console.error("[geogrid] GBP location info failed, falling back to outlet coords:", err);
  }

  const centerLat = geo.lat ?? (outlet.lat != null ? Number(outlet.lat) : null);
  const centerLng = geo.lng ?? (outlet.lng != null ? Number(outlet.lng) : null);
  if (centerLat == null || centerLng == null) {
    throw new GeoScanError("No coordinates for this outlet (set its lat/lng, or fix its Google profile)");
  }
  const targetTitle = geo.title ?? outlet.name;

  const points = buildGrid(centerLat, centerLng, gridSize, rangeMiles);
  const radiusM = Math.min(Math.max(rangeMiles * METERS_PER_MILE, 500), 5000);
  const { points: scanned, failures, competitors, sampleError, retries } = await scanGrid(apiKey, keyword, points, radiusM, geo.placeId, targetTitle);
  const metrics = computeMetrics(scanned, centerLat, centerLng);

  const scan = await prisma.geoGridScan.create({
    data: {
      outletId,
      keyword,
      gridSize,
      rangeMiles,
      centerLat,
      centerLng,
      placeId: geo.placeId,
      status: failures === 0 ? "complete" : failures < points.length ? "partial" : "failed",
      points: scanned,
      avgRank: metrics.avgRank,
      pctTop3: metrics.pctTop3,
      foundPoints: metrics.foundPoints,
      totalPoints: metrics.totalPoints,
      greenRadiusM: metrics.greenRadiusM,
      competitors,
      createdBy: createdBy ?? null,
    },
  });
  return { scan, failures, sampleError, retries };
}

// ── Scan outcomes ───────────────────────────────────────────────────────────
// A scan writes a row whatever happens, but a "failed" one (every grid point
// errored) carries no rank at all. Only scans that produced data are charged
// to the monthly budget — otherwise a persistently-failing outlet silently
// spends the whole cap on nothing and blocks every other outlet until the
// month rolls over. Attempts are bounded separately (see MAX_ATTEMPTS_PER_RUN
// in the cron route) so "failures are free" can't become unbounded API spend.
export const SCAN_STATUS_FAILED = "failed";

export function producedData(status: string): boolean {
  return status !== SCAN_STATUS_FAILED;
}

/**
 * Round-robin a due-list across outlets, preserving each outlet's own
 * warmest-first order. The queue is otherwise globally sorted by need, so one
 * outlet holding the worst ranks (or failing every scan) takes the whole run
 * and the others are never reached — which is how IOI Mall went unscanned
 * while Shah Alam burned 8 attempts a month.
 */
export function interleaveByOutlet<T extends { outletId: string }>(items: T[]): T[] {
  const byOutlet = new Map<string, T[]>();
  for (const item of items) {
    const list = byOutlet.get(item.outletId) ?? [];
    list.push(item);
    byOutlet.set(item.outletId, list);
  }
  const queues = [...byOutlet.values()];
  const out: T[] = [];
  for (let i = 0; out.length < items.length; i++) {
    for (const q of queues) if (i < q.length) out.push(q[i]);
  }
  return out;
}

// ── Adaptive cadence ────────────────────────────────────────────────────────
// A combo at goal is checked monthly; one still being worked, weekly. This is
// what concentrates the scan budget on outlets/keywords that need improvement.

export const AT_GOAL_TOP3_PCT = 70; // ≥70% of grid in top-3 ≈ won

type LastScan = { createdAt: Date; pctTop3: number | null; avgRank: number | null } | null;

export function atGoal(last: LastScan): boolean {
  return !!last && (last.pctTop3 ?? 0) >= AT_GOAL_TOP3_PCT;
}

/** At-goal combos re-checked every ~28 days; working combos every ~7; new = now. */
export function isDue(last: LastScan, now: Date): boolean {
  if (!last) return true;
  const days = (now.getTime() - new Date(last.createdAt).getTime()) / 86400000;
  return atGoal(last) ? days >= 28 : days >= 7;
}

/** Warmest-first priority: further from goal = higher. */
export function needScore(last: LastScan): number {
  if (!last) return 1000;
  return 100 - (last.pctTop3 ?? 0) + (last.avgRank ?? 20);
}
