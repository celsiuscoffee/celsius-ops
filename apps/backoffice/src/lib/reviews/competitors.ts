/**
 * The competitor an outlet "chases" for the daily rank scoreboard.
 *
 * Local rank is mostly proximity (fixed) + prominence (reviews), so the right
 * chase target is whoever actually OUT-RANKS us in the local pack, not just the
 * biggest venue nearby. Primary source is the geogrid's rank-rival (the place
 * that beats us across the grid). Fallback, when there's no geogrid signal, is
 * the nearest cafe just ahead of us in review count (a realistic next overtake)
 * rather than the absolute leader.
 *
 * Review counts come from the Places API (same key as the geogrid). searchText
 * omits review counts by default, so we add userRatingCount + rating to the
 * field mask.
 */

export type CompetitorRef = {
  name: string;
  placeId: string;
  reviews: number;
  rating: number | null;
};

async function searchCafes(
  apiKey: string,
  textQuery: string,
  lat: number,
  lng: number,
  radiusM: number,
): Promise<CompetitorRef[]> {
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
        textQuery,
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
        maxResultCount: 20,
      }),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json();
  return ((data.places ?? []) as {
    id?: string;
    displayName?: { text?: string };
    userRatingCount?: number;
    rating?: number;
  }[])
    .map((p) => ({
      name: p.displayName?.text ?? "",
      placeId: p.id ?? "",
      reviews: p.userRatingCount ?? 0,
      rating: typeof p.rating === "number" ? p.rating : null,
    }))
    .filter((c) => c.placeId && c.name);
}

/** Look up a SPECIFIC named competitor's review count (the geogrid rank-rival). */
export async function fetchCompetitorByName(
  apiKey: string,
  name: string,
  lat: number,
  lng: number,
  radiusM = 4000,
): Promise<CompetitorRef | null> {
  const results = await searchCafes(apiKey, name, lat, lng, radiusM);
  if (!results.length) return null;
  const key = name.toLowerCase().slice(0, 14);
  return results.find((r) => r.name.toLowerCase().includes(key)) ?? results[0];
}

/**
 * Fallback chase target: the nearby cafe with the smallest review lead over us
 * (the next realistic overtake). If we already lead everyone nearby, returns the
 * strongest nearby cafe as a reference so the row still has a competitor.
 */
export async function fetchNextAheadCompetitor(
  apiKey: string,
  lat: number,
  lng: number,
  ourReviews: number,
  ourPlaceId: string | null,
  radiusM = 2500,
): Promise<CompetitorRef | null> {
  const cafes = (await searchCafes(apiKey, "cafe", lat, lng, radiusM)).filter(
    (c) => c.placeId !== ourPlaceId && !/celsius/i.test(c.name),
  );
  if (!cafes.length) return null;
  const ahead = cafes.filter((c) => c.reviews > ourReviews).sort((a, b) => a.reviews - b.reviews);
  if (ahead.length) return ahead[0];
  return [...cafes].sort((a, b) => b.reviews - a.reviews)[0] ?? null;
}
