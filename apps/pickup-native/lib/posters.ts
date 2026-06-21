import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE = "https://order.celsiuscoffee.com";
const CACHE_KEY = "celsius-home-posters-v1";

export type HomePoster = {
  id: string;
  imageUrl: string;
  title: string | null;
  deeplink: string | null;
  durationMs: number;
};

// Fetch strategy: prefer fresh network data, fall back to cache only
// if the network is slow/unreachable. Operators expect a poster
// change in backoffice to surface in the app within seconds — the
// previous cache-first approach kept serving stale data because a
// successful background refetch updated AsyncStorage but not the
// React Query cache, so RQ kept returning the same stale snapshot.
//
// Network race: 4s timeout (longer than the 2.5s we used for cache-
// first since the network IS now the primary source). If it loses,
// fall back to whatever's in AsyncStorage. If both fail, return [].
export async function getHomePosters(memberId: string | null = null): Promise<HomePoster[]> {
  // Personalized sets cache per-member so a guest and a signed-in member don't
  // overwrite each other's snapshot (guest keeps the legacy base key).
  const cacheKey = memberId ? `${CACHE_KEY}:${memberId}` : CACHE_KEY;
  let resolved = false;
  let cached: HomePoster[] | null = null;

  // Read cache in parallel with the fetch.
  const cacheRead: Promise<HomePoster[] | null> = (async () => {
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      return raw ? (JSON.parse(raw) as HomePoster[]) : null;
    } catch {
      return null;
    }
  })();

  const network = fetchPosters(memberId).then((posters) => {
    resolved = true;
    return posters;
  });

  // Race fresh vs. 4s timeout.
  const winner = await Promise.race<HomePoster[] | "timeout">([
    network,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 4000)),
  ]);

  if (winner !== "timeout") {
    return winner;
  }

  // Network slow — fall back to cached data if we have it. The
  // network promise is still in flight; let it complete in the
  // background and update the cache for the next launch.
  cached = await cacheRead;
  if (cached && cached.length > 0) return cached;

  // No cache either. Wait a bit longer for the network — slow
  // connection but no point returning empty if we'll have data soon.
  if (!resolved) {
    const second = await Promise.race<HomePoster[] | "timeout">([
      network,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 4000)),
    ]);
    if (second !== "timeout") return second;
  }
  return [];
}

async function fetchPosters(memberId: string | null = null): Promise<HomePoster[]> {
  const cacheKey = memberId ? `${CACHE_KEY}:${memberId}` : CACHE_KEY;
  try {
    const url = `${API_BASE}/api/home-posters?brand_id=brand-celsius${memberId ? `&member=${encodeURIComponent(memberId)}` : ""}`;
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        Origin: API_BASE,
        Referer: API_BASE + "/",
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { posters: HomePoster[] };
    const posters = json.posters ?? [];
    if (posters.length > 0) {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(posters)).catch(() => {});
    } else {
      await AsyncStorage.removeItem(cacheKey).catch(() => {});
    }
    return posters;
  } catch {
    return [];
  }
}
