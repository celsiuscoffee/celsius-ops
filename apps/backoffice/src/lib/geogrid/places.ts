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

export type PointResult = { name: string; placeId: string; isUs: boolean };

// `results` = the ranked businesses returned at this point (index 0 = local #1),
// kept so the UI can show "who out-ranks us here" per grid cell. Optional for
// back-compat with scans recorded before per-point results were stored.
export type GridPoint = {
  row: number;
  col: number;
  lat: number;
  lng: number;
  rank: number | null;
  results?: PointResult[];
};

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

export type Competitor = { name: string; top3Points: number; avgRank: number };

/** Our rank + the ranked businesses (for the competitor reference) at one point. */
export async function rankAtPoint(
  apiKey: string,
  keyword: string,
  lat: number,
  lng: number,
  radiusM: number,
  targetPlaceId: string | null,
  targetTitle: string | null,
): Promise<{ rank: number | null; results: PointResult[] }> {
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
  const isUs = (p: { id?: string; displayName?: { text?: string } }) =>
    (!!targetPlaceId && p.id === targetPlaceId) ||
    (!!title && !!p.displayName?.text?.toLowerCase().includes(title));
  const idx = places.findIndex(isUs);
  const results: PointResult[] = places.slice(0, 8).map((p) => ({
    name: p.displayName?.text ?? "",
    placeId: p.id ?? "",
    isUs: isUs(p),
  }));
  return { rank: idx >= 0 ? idx + 1 : null, results };
}

// ── Profile comparison ───────────────────────────────────────────────────────
// To advise how to out-rank a specific rival, we pull the prominence signals
// Google's local ranking leans on (reviews, rating, profile completeness) for
// both businesses and diff them into concrete to-dos.

export type PlaceProfile = {
  placeId: string;
  name: string;
  rating: number | null;
  reviews: number | null;
  hasWebsite: boolean;
  hasPhone: boolean;
  hasHours: boolean;
  photos: number;
  hasDescription: boolean;
  primaryType: string | null;
  businessStatus: string | null;
  location: { lat: number; lng: number } | null;
};

/** Place Details (New) for one place — the fields that feed prominence. */
export async function placeDetails(apiKey: string, placeId: string): Promise<PlaceProfile> {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "id,displayName,rating,userRatingCount,websiteUri,nationalPhoneNumber,regularOpeningHours,photos,editorialSummary,primaryTypeDisplayName,businessStatus,location",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places details error ${res.status}: ${body.slice(0, 200)}`);
  }
  const p = await res.json();
  return {
    placeId: p.id ?? placeId,
    name: p.displayName?.text ?? "",
    rating: typeof p.rating === "number" ? p.rating : null,
    reviews: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    hasWebsite: !!p.websiteUri,
    hasPhone: !!p.nationalPhoneNumber,
    hasHours: !!p.regularOpeningHours,
    photos: Array.isArray(p.photos) ? p.photos.length : 0,
    hasDescription: !!p.editorialSummary?.text,
    primaryType: p.primaryTypeDisplayName?.text ?? null,
    businessStatus: p.businessStatus ?? null,
    location:
      typeof p.location?.latitude === "number" && typeof p.location?.longitude === "number"
        ? { lat: p.location.latitude, lng: p.location.longitude }
        : null,
  };
}

export type Suggestion = { tag: string; priority: "high" | "med" | "low"; text: string; levers: string[] };

/** Concrete actions to close the gap on `them`, given our profile (or null). */
export function buildSuggestions(us: PlaceProfile | null, them: PlaceProfile): Suggestion[] {
  // Every tip is a concrete action with a number and a timeframe, aimed at the
  // prominence signals that move local rank, so you can actually out-rank them.
  const out: Suggestion[] = [];
  const PACE = 5; // realistic reviews/week from asking every happy customer
  const reviewsUs = us?.reviews ?? 0;
  const reviewsThem = them.reviews ?? 0;

  // Reviews — overtake their review count (the strongest rank lever).
  if (reviewsThem > reviewsUs) {
    const target = reviewsThem - reviewsUs + 1; // pass them, not just match
    const weeks = Math.ceil(target / PACE);
    out.push({
      tag: "Reviews",
      priority: target > 50 ? "high" : "med",
      text: `Get +${target} reviews to pass their ${reviewsThem}. At ${PACE}/week → ~${weeks} week${weeks > 1 ? "s" : ""}.`,
      levers: [
        "Staff asks for a review the moment a customer compliments the coffee — hand them a QR card.",
        "Print a Google review QR on receipts and table tents.",
        "Text/WhatsApp a one-tap review link to loyalty members after purchase.",
        "Reply to every existing review — active profiles rank better.",
      ],
    });
  }

  // Rating — 5★ reviews needed to lift your average past theirs.
  if (them.rating != null && them.rating < 5 && us?.rating != null && us.rating + 0.05 < them.rating) {
    const need = Math.ceil((reviewsUs * (them.rating - us.rating)) / (5 - them.rating));
    if (need > 0) {
      const weeks = Math.ceil(need / PACE);
      out.push({
        tag: "Rating",
        priority: "med",
        text: `Lift your ${us.rating.toFixed(1)}★ past their ${them.rating.toFixed(1)}★: ~${need} new 5★ reviews. At ${PACE}/week → ~${weeks} week${weeks > 1 ? "s" : ""}.`,
        levers: [
          "Train staff to fix complaints on the spot, before the customer leaves.",
          "Catch unhappy customers privately (receipt feedback link) and resolve before they post.",
          "Only prompt for reviews after a clear win — fresh bake, fast service, a regular.",
        ],
      });
    }
  }

  // Profile completeness — one-time fixes, each time-boxed.
  if (them.hasHours && us && !us.hasHours) {
    out.push({
      tag: "Hours",
      priority: "high",
      text: "Add opening hours — 5-min fix today. Missing hours get down-ranked.",
      levers: ["Google Business Profile → Edit profile → Hours → set regular + holiday hours."],
    });
  }
  if (them.hasWebsite && us && !us.hasWebsite) {
    out.push({
      tag: "Website",
      priority: "med",
      text: "Add your website / menu link — 2-min fix today.",
      levers: ["Edit profile → Contact → Website: link your site or online-order/menu page."],
    });
  }
  if (them.hasPhone && us && !us.hasPhone) {
    out.push({
      tag: "Phone",
      priority: "low",
      text: "Add a phone number — 1-min fix today.",
      levers: ["Edit profile → Contact → Phone: add your primary number."],
    });
  }
  if (us && them.photos > us.photos) {
    const add = Math.max(them.photos - us.photos, 5);
    out.push({
      tag: "Photos",
      priority: "low",
      text: `Add ${add} photos — ~15 min today, then 2/week to stay fresh.`,
      levers: [
        "Maps app → your business → Add photos: storefront, interior, menu board, 3-5 hero drinks.",
        "Set a weekly reminder to post 2 fresh photos.",
      ],
    });
  }
  if (them.hasDescription && us && !us.hasDescription) {
    out.push({
      tag: "Description",
      priority: "low",
      text: "Add a description with your key search terms — 10-min fix today.",
      levers: ["Edit profile → Description: include 'specialty coffee', your area and signature items."],
    });
  }

  if (out.length === 0) {
    out.push({
      tag: us ? "Even" : "Note",
      priority: "low",
      text: us
        ? `Profile matches theirs — win on velocity to climb past them.`
        : `Link your profile to compare. Meanwhile, work the basics.`,
      levers: us
        ? [`Keep ${PACE} reviews/week flowing.`, "Post 1 Google update/week (offer, new drink, event)."]
        : [`Aim for ${PACE} reviews/week.`, "Add hours, website and 5 photos today."],
    });
  }
  return out;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A 9×9 grid at concurrency 8 with no pacing peaks well above the Places API
// per-minute quota when several scans run back-to-back (observed 2026-07-06:
// mid-run quota exhaustion turned whole scans into instant 81-point failures).
// Enforcing a minimum batch duration caps the steady rate at
// concurrency/MIN_BATCH_MS ≈ 8 req/s, and quota errors get a paced retry.
const MIN_BATCH_MS = 1000;
const RETRIES_PER_POINT = 2;

/** Run all grid points with limited concurrency, also tallying who out-ranks us. */
export async function scanGrid(
  apiKey: string,
  keyword: string,
  points: GridPoint[],
  radiusM: number,
  targetPlaceId: string | null,
  targetTitle: string | null,
  concurrency = 8,
): Promise<{ points: GridPoint[]; failures: number; competitors: Competitor[] }> {
  let failures = 0;
  const tally = new Map<string, { name: string; top3: number; rankSum: number; count: number }>();

  for (let i = 0; i < points.length; i += concurrency) {
    const batch = points.slice(i, i + concurrency);
    const batchStart = Date.now();
    await Promise.all(
      batch.map(async (p) => {
        let lastErr: Error | null = null;
        for (let attempt = 0; attempt <= RETRIES_PER_POINT; attempt++) {
          try {
            const { rank, results } = await rankAtPoint(apiKey, keyword, p.lat, p.lng, radiusM, targetPlaceId, targetTitle);
            p.rank = rank;
            p.results = results;
            results.forEach((r, i2) => {
              if (r.isUs || !r.name) return;
              const key = r.placeId || r.name.toLowerCase();
              const t = tally.get(key) ?? { name: r.name, top3: 0, rankSum: 0, count: 0 };
              t.count++;
              t.rankSum += i2 + 1;
              if (i2 < 3) t.top3++;
              tally.set(key, t);
            });
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err as Error;
            if (attempt < RETRIES_PER_POINT) {
              // Quota (429) refills on a per-minute window — wait longer for it.
              const quota = /\b429\b|RESOURCE_EXHAUSTED/i.test(lastErr.message);
              await sleep((attempt + 1) * (quota ? 5000 : 1000));
            }
          }
        }
        if (lastErr) {
          failures++;
          console.error(`[geogrid] point ${p.row},${p.col} failed:`, lastErr.message);
          p.rank = null;
        }
      }),
    );
    const elapsed = Date.now() - batchStart;
    if (i + concurrency < points.length && elapsed < MIN_BATCH_MS) await sleep(MIN_BATCH_MS - elapsed);
  }

  const competitors: Competitor[] = [...tally.values()]
    .map((t) => ({ name: t.name, top3Points: t.top3, avgRank: t.count ? t.rankSum / t.count : 0 }))
    .sort((a, b) => b.top3Points - a.top3Points || a.avgRank - b.avgRank)
    .slice(0, 6);

  return { points, failures, competitors };
}
