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

// Returns the cached list immediately if we have one + kicks off a
// background refresh, OR races a fresh fetch against a 2.5s timeout
// for first launches. Empty array means "no posters scheduled" — the
// home page hides the carousel in that case.
export async function getHomePosters(): Promise<HomePoster[]> {
  let cached: HomePoster[] | null = null;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) cached = JSON.parse(raw);
  } catch {
    // ignore
  }

  if (cached && cached.length > 0) {
    fetchPosters().catch(() => {});
    return cached;
  }

  return Promise.race<HomePoster[]>([
    fetchPosters(),
    new Promise<HomePoster[]>((resolve) => setTimeout(() => resolve([]), 2500)),
  ]);
}

async function fetchPosters(): Promise<HomePoster[]> {
  try {
    const res = await fetch(
      `${API_BASE}/api/home-posters?brand_id=brand-celsius`,
      {
        headers: {
          "Content-Type": "application/json",
          Origin: API_BASE,
          Referer: API_BASE + "/",
        },
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { posters: HomePoster[] };
    const posters = json.posters ?? [];
    if (posters.length > 0) {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(posters)).catch(() => {});
    } else {
      await AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
    }
    return posters;
  } catch {
    return [];
  }
}
