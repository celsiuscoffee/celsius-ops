/**
 * Geogrid local-rank reconstruction via the Google Places API (New).
 *
 * The GBP API can't tell you your map-pack rank. So we reconstruct it: lay an
 * N×N grid of points around an outlet, and at each point run Places Text Search
 * ("coffee near me", biased to that point). Where our listing lands in the
 * results IS our rank at that cell. Color the cells by rank → the geogrid.
 *
 * The owner's objective is to expand the radius over which the cell rank is #1
 * (#1-reach). The metrics below quantify that so the loop can read a trend.
 *
 * Credentials: GOOGLE_PLACES_API_KEY (Maps Platform key with the Places API
 * (New) enabled). Billed per searchText call — see geogrid-config.ts for the
 * cost math.
 */

import { BRAND_MATCH } from "./geogrid-config";

const PLACES_SEARCH_TEXT = "https://places.googleapis.com/v1/places:searchText";

// Places Text Search returns at most 20 results per call. A listing we never
// see within the top 20 is treated as this rank for averaging — bad, but
// bounded, so one invisible cell can't blow up ATRP to infinity.
export const NOT_FOUND_RANK = 21;
export const MAX_RESULTS = 20;

// ─── Grid geometry ─────────────────────────────────────────

export type GridCell = {
  row: number; // 0 = north (top of the grid)
  col: number; // 0 = west (left)
  lat: number;
  lng: number;
  distKm: number; // straight-line distance from the centre (the outlet)
};

const KM_PER_DEG_LAT = 110.574;

/**
 * Build an N×N grid centred on (lat, lng) with `spacingKm` between adjacent
 * cells. N should be odd so the centre cell sits exactly on the outlet.
 */
export function buildGrid(lat: number, lng: number, size: number, spacingKm: number): GridCell[] {
  const half = (size - 1) / 2;
  const kmPerDegLng = 111.32 * Math.cos((lat * Math.PI) / 180);
  const cells: GridCell[] = [];

  for (let row = 0; row < size; row++) {
    // row 0 = north → positive latitude offset; increasing row moves south.
    const dNorthKm = (half - row) * spacingKm;
    for (let col = 0; col < size; col++) {
      const dEastKm = (col - half) * spacingKm;
      cells.push({
        row,
        col,
        lat: lat + dNorthKm / KM_PER_DEG_LAT,
        lng: lng + dEastKm / kmPerDegLng,
        distKm: Math.hypot(dNorthKm, dEastKm),
      });
    }
  }
  return cells;
}

// ─── Places query: our rank at one point ───────────────────

type PlacesSearchResponse = {
  places?: Array<{ id?: string; displayName?: { text?: string } }>;
};

/**
 * Run Text Search biased to (lat, lng) and return our 1-based rank in the
 * results, or null if we don't appear in the top 20.
 *
 * Identification: prefer an exact place_id match (set on the outlet's
 * ReviewSettings.gbpPlaceId); fall back to a brand-name substring.
 */
export async function searchRankAtPoint(opts: {
  keyword: string;
  lat: number;
  lng: number;
  biasRadiusM: number;
  targetPlaceId?: string | null;
  apiKey: string;
}): Promise<number | null> {
  const { keyword, lat, lng, biasRadiusM, targetPlaceId, apiKey } = opts;

  const res = await fetch(PLACES_SEARCH_TEXT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName",
    },
    body: JSON.stringify({
      textQuery: keyword,
      maxResultCount: MAX_RESULTS,
      locationBias: {
        circle: { center: { latitude: lat, longitude: lng }, radius: biasRadiusM },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places searchText ${res.status}: ${body}`);
  }

  const data: PlacesSearchResponse = await res.json();
  const places = data.places ?? [];

  const idx = places.findIndex((p) => {
    if (targetPlaceId && p.id === targetPlaceId) return true;
    return (p.displayName?.text ?? "").toLowerCase().includes(BRAND_MATCH);
  });

  return idx === -1 ? null : idx + 1;
}

// ─── Metrics ───────────────────────────────────────────────

export type RankedCell = GridCell & { rank: number | null };

export type GeoMetrics = {
  atrp: number; // average total rank position (lower better); not-found = NOT_FOUND_RANK
  solv: number; // share of local voice: % of cells in the top 3 (0..100)
  oneReachKm: number; // radius of the largest concentric ring whose median cell rank is 1
  foundCells: number; // cells where we appeared at all
  totalCells: number;
};

function median(nums: number[]): number {
  if (nums.length === 0) return NOT_FOUND_RANK;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeMetrics(cells: RankedCell[]): GeoMetrics {
  const total = cells.length;
  const effRank = (c: RankedCell) => c.rank ?? NOT_FOUND_RANK;

  const atrp = total === 0 ? NOT_FOUND_RANK : cells.reduce((s, c) => s + effRank(c), 0) / total;
  const top3 = cells.filter((c) => c.rank != null && c.rank <= 3).length;
  const solv = total === 0 ? 0 : (top3 / total) * 100;

  // #1-reach: walk outward ring by ring; keep extending while the median rank
  // of everything inside the ring is still 1. Stop at the first ring that
  // isn't — that's the edge of the concentric #1 zone.
  const radii = [...new Set(cells.map((c) => Number(c.distKm.toFixed(3))))].sort((a, b) => a - b);
  let oneReachKm = 0;
  for (const r of radii) {
    const within = cells.filter((c) => c.distKm <= r + 1e-9).map(effRank);
    if (median(within) === 1) oneReachKm = r;
    else break;
  }

  return {
    atrp: Number(atrp.toFixed(2)),
    solv: Number(solv.toFixed(1)),
    oneReachKm: Number(oneReachKm.toFixed(2)),
    foundCells: cells.filter((c) => c.rank != null).length,
    totalCells: total,
  };
}

// ─── Concurrency pool ──────────────────────────────────────

/** Run `worker` over `items` with bounded concurrency, preserving order. */
async function pool<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    let i = next++;
    while (i < items.length) {
      results[i] = await worker(items[i], i);
      i = next++;
    }
  });
  await Promise.all(runners);
  return results;
}

// ─── One full geogrid sweep for one (outlet, keyword) ──────

export type GeogridResult = {
  cells: RankedCell[];
  metrics: GeoMetrics;
  callCount: number;
};

/**
 * Sweep one keyword across the grid for one outlet. Cells that error out (rate
 * limit, transient) keep rank = null rather than aborting the whole sweep.
 */
export async function runGeogridForKeyword(opts: {
  keyword: string;
  centerLat: number;
  centerLng: number;
  gridSize: number;
  spacingKm: number;
  biasRadiusM: number;
  targetPlaceId?: string | null;
  apiKey: string;
  concurrency?: number;
}): Promise<GeogridResult> {
  const grid = buildGrid(opts.centerLat, opts.centerLng, opts.gridSize, opts.spacingKm);

  const ranked = await pool<GridCell, RankedCell>(grid, opts.concurrency ?? 8, async (cell) => {
    try {
      const rank = await searchRankAtPoint({
        keyword: opts.keyword,
        lat: cell.lat,
        lng: cell.lng,
        biasRadiusM: opts.biasRadiusM,
        targetPlaceId: opts.targetPlaceId,
        apiKey: opts.apiKey,
      });
      return { ...cell, rank };
    } catch (err) {
      console.error(`[geogrid] cell (${cell.row},${cell.col}) "${opts.keyword}" failed:`, err);
      return { ...cell, rank: null };
    }
  });

  return { cells: ranked, metrics: computeMetrics(ranked), callCount: grid.length };
}
