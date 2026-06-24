/**
 * Geogrid engine for the local-rank loop.
 *
 * Builds an N×N grid of points around an outlet, asks the Places API "where do
 * we rank for <keyword> as searched from here" at each point, and rolls the
 * results into the two loop metrics: average rank (lower = better) and green
 * radius (how far from the store we still rank top-3 = prominence/reach).
 *
 * NOTE: Places searchText with a locationBias circle is an APPROXIMATION of the
 * real Maps local pack — good for relative rank + trend over time, not an exact
 * mirror of what a user sees. That's fine for a measure→act→learn loop.
 */

const MILES_PER_DEG_LAT = 69.0;

export type GridPoint = { row: number; col: number; lat: number; lng: number; rank: number | null };

/** N×N points centred on (lat,lng), spaced `rangeMiles` apart. Row 0 = north. */
export function buildGrid(centerLat: number, centerLng: number, gridSize: number, rangeMiles: number): GridPoint[] {
  const latStep = rangeMiles / MILES_PER_DEG_LAT;
  const lngStep = rangeMiles / (MILES_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180));
  const half = (gridSize - 1) / 2;
  const points: GridPoint[] = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      points.push({
        row,
        col,
        lat: centerLat - (row - half) * latStep, // row 0 → north (higher lat)
        lng: centerLng + (col - half) * lngStep, // col 0 → west (lower lng)
        rank: null,
      });
    }
  }
  return points;
}

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Rank of the target business in Places results for `keyword` at a point, or null if not in top 20. */
export async function rankAtPoint(
  apiKey: string,
  keyword: string,
  lat: number,
  lng: number,
  radiusM: number,
  targetPlaceId: string | null,
  targetTitle: string | null,
): Promise<number | null> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName",
    },
    body: JSON.stringify({
      textQuery: keyword,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
      maxResultCount: 20,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places searchText error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const places: { id?: string; displayName?: { text?: string } }[] = data.places ?? [];
  const title = targetTitle?.toLowerCase();
  const idx = places.findIndex(
    (p) =>
      (targetPlaceId && p.id === targetPlaceId) ||
      (title && p.displayName?.text?.toLowerCase().includes(title)),
  );
  return idx >= 0 ? idx + 1 : null;
}

export function computeMetrics(points: GridPoint[], centerLat: number, centerLng: number) {
  const ranked = points.filter((p) => p.rank != null) as (GridPoint & { rank: number })[];
  const top3 = ranked.filter((p) => p.rank <= 3);
  return {
    avgRank: ranked.length ? ranked.reduce((s, p) => s + p.rank, 0) / ranked.length : null,
    pctTop3: points.length ? (top3.length / points.length) * 100 : 0,
    foundPoints: ranked.length,
    totalPoints: points.length,
    greenRadiusM: top3.length
      ? Math.max(...top3.map((p) => distanceMeters(centerLat, centerLng, p.lat, p.lng)))
      : 0,
  };
}

/** Run all grid points with limited concurrency so we don't hammer the Places API. */
export async function scanGrid(
  apiKey: string,
  keyword: string,
  points: GridPoint[],
  radiusM: number,
  targetPlaceId: string | null,
  targetTitle: string | null,
  concurrency = 8,
): Promise<{ points: GridPoint[]; failures: number }> {
  let failures = 0;
  for (let i = 0; i < points.length; i += concurrency) {
    const batch = points.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (p) => {
        try {
          p.rank = await rankAtPoint(apiKey, keyword, p.lat, p.lng, radiusM, targetPlaceId, targetTitle);
        } catch (err) {
          failures++;
          console.error(`[geogrid] point ${p.row},${p.col} failed:`, (err as Error).message);
          p.rank = null;
        }
      }),
    );
  }
  return { points, failures };
}
