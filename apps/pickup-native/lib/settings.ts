import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE = "https://order.celsiuscoffee.com";
const CACHE_PREFIX = "celsius-setting-v1-";

// Type contracts for each settings key — kept narrow so consumers get autocomplete.
export type Settings = {
  sst: { rate: number; enabled: boolean };
  points_per_rm: { rate: number };
  min_order_value: { rm: number };
  maintenance: { enabled: boolean; message: string };
  min_app_version: { ios: string; android: string; forceUpdate: boolean };
  promo_banner: {
    enabled: boolean;
    label?: string;
    headline?: string;
    highlight?: string;
    description?: string;
    image_url?: string;
    cta_text?: string;
    cta_target?: "menu" | "store" | "rewards" | "url";
    cta_url?: string;
  };
  payments_enabled: { enabled: boolean };
};

const DEFAULTS: Settings = {
  sst: { rate: 0.06, enabled: true },
  points_per_rm: { rate: 1 },
  min_order_value: { rm: 0 },
  maintenance: { enabled: false, message: "" },
  min_app_version: { ios: "1.0.0", android: "1.0.0", forceUpdate: false },
  promo_banner: { enabled: false },
  payments_enabled: { enabled: true },
};

// Read cached value first, return immediately, and refresh in background.
// Consumers should be tolerant of slightly stale values.
export async function getSetting<K extends keyof Settings>(
  key: K
): Promise<Settings[K]> {
  let cached: Settings[K] | null = null;
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (raw) cached = JSON.parse(raw);
  } catch {
    // ignore
  }

  refresh(key).catch(() => {
    // network failures are fine; cached value will serve
  });

  return cached ?? DEFAULTS[key];
}

async function refresh<K extends keyof Settings>(key: K) {
  const res = await fetch(
    `${API_BASE}/api/settings?key=${encodeURIComponent(key)}`,
    {
      headers: {
        "Content-Type": "application/json",
        Origin: API_BASE,
        Referer: API_BASE + "/",
      },
    }
  );
  if (!res.ok) return;
  const value = await res.json();
  if (value !== null && value !== undefined) {
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  }
}
