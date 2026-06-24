/**
 * Top nearby competitor by review prominence, for the daily rank scoreboard.
 *
 * Local rank is mostly proximity (fixed) + prominence (reviews). The outlet
 * "chases" the most-reviewed nearby cafe: out-review them and the geogrid
 * rings extend. This pulls that competitor's live review count via the Places
 * API (the same key the geogrid uses). searchText alone omits review counts,
 * so we add userRatingCount + rating to the field mask.
 */

export type TopCompetitor = {
  name: string;
  placeId: string;
  reviews: number;
  rating: number | null;
};

/**
 * The single most-reviewed cafe within `radiusM` of (lat,lng) that is NOT us.
 * Returns null on API failure or if nothing usable comes back.
 */
export async function fetchTopCompetitor(
  apiKey: string,
  lat: number,
  lng: number,
  ourPlaceId: string | null,
  radiusM = 2500,
): Promise<TopCompetitor | null> {
  let res: Response;
  try {
    res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.userRatingCount,places.rating",
      },
      body: JSON.stringify({
        textQuery: "cafe",
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
        maxResultCount: 20,
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json();
  const places = (data.places ?? []) as {
    id?: string;
    displayName?: { text?: string };
    userRatingCount?: number;
    rating?: number;
  }[];

  const ranked = places
    .map((p) => ({
      name: p.displayName?.text ?? "",
      placeId: p.id ?? "",
      reviews: p.userRatingCount ?? 0,
      rating: typeof p.rating === "number" ? p.rating : null,
    }))
    // exclude us: by place id, and by name so our other outlets never count
    .filter((c) => c.placeId && c.placeId !== ourPlaceId && !/celsius/i.test(c.name))
    .sort((a, b) => b.reviews - a.reviews);

  return ranked[0] ?? null;
}
