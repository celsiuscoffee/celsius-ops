import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE = "https://order.celsiuscoffee.com";
// v2: bumped from v1 to drop stale cache pointing at the old
// celsius-coffee/products/misc.jpg path, which Cloudinary overwrote
// across uploads and so served a different image than the operator
// expected. The new uploader writes to celsius-coffee/posters/{uuid}
// so each poster has a stable, immutable URL.
const CACHE_KEY = "celsius-splash-poster-v2";

export type SplashPoster = {
  id: string;
  imageUrl: string;
  deeplink: string | null;
  durationMs: number;
};

// Cold-launch flow — network-first, cache as fallback.
//
// Earlier this was cache-first with a background refetch. That caused
// operator changes in backoffice to take TWO cold launches to surface
// (first launch served stale cache; bg fetch updated cache; second
// launch served fresh). Now we race a fresh fetch against a tight
// 1.5s timeout: typical fast launches still get the freshest poster,
// slow networks fall back to whatever's in cache so we don't block
// the splash forever.
export async function getSplashPoster(): Promise<SplashPoster | null> {
  const network = fetchPoster();

  const winner = await Promise.race<SplashPoster | null | "timeout">([
    network,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1500)),
  ]);

  if (winner !== "timeout") {
    return winner;
  }

  // Network slow — fall back to whatever's cached. Let the network
  // promise complete in the background so the cache is fresh for
  // the next launch.
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw) as SplashPoster;
  } catch {
    // ignore
  }
  return null;
}

async function fetchPoster(): Promise<SplashPoster | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/splash-poster?brand_id=brand-celsius`,
      {
        headers: {
          "Content-Type": "application/json",
          Origin: API_BASE,
          Referer: API_BASE + "/",
        },
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { poster: SplashPoster | null };
    if (json.poster) {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(json.poster)).catch(
        () => {}
      );
    } else {
      await AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
    }
    return json.poster;
  } catch {
    return null;
  }
}
