/**
 * Google Places API (New) — Nearby Search helper for the Reviews module's
 * "Nearby Competitor Ranking" card.
 *
 * The Google Business Profile API gives us our OWN reviews/rating but has no
 * concept of "who's nearby". To rank an outlet against the cafés around it we
 * use Places API (New) Nearby Search, which returns each nearby place's
 * `rating` + `userRatingCount` — an apples-to-apples dataset to rank within.
 *
 * Auth: a Places API key (X-Goog-Api-Key), NOT the GBP OAuth credentials.
 * Set GOOGLE_PLACES_API_KEY (enable "Places API (New)" on the same Google
 * Cloud project that powers GBP, then mint an API key).
 *
 * Cost note: `rating`/`userRatingCount` are Enterprise-SKU fields (~$0.035 per
 * call). We call this on a daily cron (one call per outlet) and cache the
 * result in CompetitorSnapshot — never live on dashboard load.
 */

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
// Only ask for the fields we rank on — a tighter field mask is cheaper and faster.
const FIELD_MASK =
  "places.id,places.displayName,places.rating,places.userRatingCount,places.location";

/** Search radius in metres. 1.5km ≈ the cafés a customer would realistically pick between. */
export const DEFAULT_RADIUS_M = 1500;

/** A café returned by Nearby Search, normalised for our use. */
export type NearbyCafe = {
  placeId: string;
  name: string;
  rating: number | null;
  reviewCount: number;
  distanceM: number;
  lat: number;
  lng: number;
};

export type CompetitorRanking = {
  /** Did we find our own outlet inside the nearby set? */
  selfFound: boolean;
  selfPlaceId: string | null;
  selfRating: number | null;
  selfReviewCount: number | null;
  /** 1-based rank by review volume (lower = more reviews than rivals). */
  rankByReviews: number | null;
  /** 1-based rank by star rating. */
  rankByRating: number | null;
  /** Total cafés in the set, INCLUDING our own outlet. */
  totalNearby: number;
  /** Rivals only (self excluded), sorted by review volume desc. */
  competitors: NearbyCafe[];
};

// ─── Distance ──────────────────────────────────────────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ─── Nearby Search ─────────────────────────────────────────

/**
 * Return up to 20 cafés nearest to (lat, lng) within `radiusM`.
 *
 * rankPreference=DISTANCE (not POPULARITY) so our own outlet — distance ~0 —
 * is guaranteed to be in the result set, which is what lets us rank ourselves.
 */
export async function searchNearbyCafes(
  lat: number,
  lng: number,
  radiusM: number = DEFAULT_RADIUS_M,
): Promise<NearbyCafe[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_PLACES_API_KEY not configured");
  }

  const res = await fetch(PLACES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: ["cafe", "coffee_shop"],
      maxResultCount: 20,
      rankPreference: "DISTANCE",
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusM,
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    places?: Array<{
      id: string;
      displayName?: { text?: string };
      rating?: number;
      userRatingCount?: number;
      location?: { latitude?: number; longitude?: number };
    }>;
  };

  return (data.places ?? []).map((p) => {
    const pLat = p.location?.latitude ?? lat;
    const pLng = p.location?.longitude ?? lng;
    return {
      placeId: p.id,
      name: p.displayName?.text ?? "Unknown café",
      rating: typeof p.rating === "number" ? p.rating : null,
      reviewCount: p.userRatingCount ?? 0,
      lat: pLat,
      lng: pLng,
      distanceM: Math.round(haversineMeters(lat, lng, pLat, pLng)),
    };
  });
}

// ─── Ranking ───────────────────────────────────────────────

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sortByReviews(cafes: NearbyCafe[]): NearbyCafe[] {
  return [...cafes].sort((a, b) => b.reviewCount - a.reviewCount || (b.rating ?? 0) - (a.rating ?? 0));
}

/**
 * Identify our own outlet inside the nearby set and rank it.
 *
 * Self-match order: stored Place ID → café whose name contains `selfNameHint`
 * (nearest such, e.g. "celsius") → the café sitting on top of our coordinates
 * (≤60m). If none match, we still return the competitor list but with no rank.
 */
export function computeRanking(
  cafes: NearbyCafe[],
  opts: { selfPlaceId?: string | null; selfNameHint?: string },
): CompetitorRanking {
  let self: NearbyCafe | undefined;

  if (opts.selfPlaceId) {
    self = cafes.find((c) => c.placeId === opts.selfPlaceId);
  }
  if (!self && opts.selfNameHint) {
    const hint = normalizeName(opts.selfNameHint);
    if (hint) {
      self = cafes
        .filter((c) => normalizeName(c.name).includes(hint))
        .sort((a, b) => a.distanceM - b.distanceM)[0];
    }
  }
  if (!self) {
    const nearest = [...cafes].sort((a, b) => a.distanceM - b.distanceM)[0];
    if (nearest && nearest.distanceM <= 60) self = nearest;
  }

  if (!self) {
    return {
      selfFound: false,
      selfPlaceId: null,
      selfRating: null,
      selfReviewCount: null,
      rankByReviews: null,
      rankByRating: null,
      totalNearby: cafes.length,
      competitors: sortByReviews(cafes),
    };
  }

  const selfReviews = self.reviewCount;
  const selfRating = self.rating;
  const rankByReviews = 1 + cafes.filter((c) => c.reviewCount > selfReviews).length;
  const rankByRating =
    selfRating == null
      ? null
      : 1 + cafes.filter((c) => (c.rating ?? -1) > selfRating).length;

  return {
    selfFound: true,
    selfPlaceId: self.placeId,
    selfRating,
    selfReviewCount: selfReviews,
    rankByReviews,
    rankByRating,
    totalNearby: cafes.length,
    competitors: sortByReviews(cafes.filter((c) => c.placeId !== self!.placeId)),
  };
}
