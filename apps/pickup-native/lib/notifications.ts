import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE = "https://order.celsiuscoffee.com";
const STORED_TOKEN_KEY = "celsius-expo-push-token-v1";

// Foreground notifications: show banner + play sound. iOS especially —
// without this set up, banners are suppressed when the app is in the
// foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner:    true,
    shouldShowList:      true,
    shouldPlaySound:     true,
    shouldSetBadge:      false,
  }),
});

export type RegisterCtx = {
  phone?:    string | null;
  memberId?: string | null;
};

/**
 * Asks for push permission (iOS prompt is one-shot — silently no-ops on
 * subsequent launches), retrieves the Expo push token, and POSTs it to
 * the server scoped to the customer's phone.
 *
 * Safe to call repeatedly. Caches the token + skips re-registration when
 * the same token + phone tuple has already been sent.
 */
export async function registerForPush(ctx: RegisterCtx): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators can't receive push

  // Permission
  const settings = await Notifications.getPermissionsAsync();
  let granted =
    settings.granted ||
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!granted) {
    const req = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    granted =
      req.granted ||
      req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  }
  if (!granted) return null;

  // Token
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants.easConfig as { projectId?: string } | undefined)?.projectId;

  let token: string;
  try {
    const res = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    token = res.data;
  } catch (err) {
    console.warn("getExpoPushTokenAsync failed:", err);
    return null;
  }

  // Skip the network round-trip if we've already registered the same
  // (token, phone) tuple.
  const cached = await AsyncStorage.getItem(STORED_TOKEN_KEY).catch(() => null);
  const fingerprint = `${token}::${ctx.phone ?? ""}`;
  if (cached === fingerprint) return token;

  try {
    const res = await fetch(`${API_BASE}/api/loyalty/push/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin:  API_BASE,
        Referer: API_BASE + "/",
      },
      body: JSON.stringify({
        token,
        phone:      ctx.phone ?? null,
        memberId:   ctx.memberId ?? null,
        platform:   Platform.OS,
        appVersion: Constants.expoConfig?.version ?? null,
      }),
    });
    if (res.ok) {
      await AsyncStorage.setItem(STORED_TOKEN_KEY, fingerprint).catch(() => {});
    }
  } catch (err) {
    console.warn("push register POST failed:", err);
  }

  return token;
}

/**
 * Drop the push-token row server-side and clear the local cache.
 * Call on sign-out so the previous customer's phone stops receiving
 * order pushes for any future order placed on this device. Failures
 * are swallowed — local sign-out must always succeed.
 */
export async function deregisterPush(): Promise<void> {
  let token: string | null = null;
  try {
    const cached = await AsyncStorage.getItem(STORED_TOKEN_KEY);
    // Cache value is "<token>::<phone>" (see registerForPush).
    if (cached) token = cached.split("::")[0] ?? null;
  } catch {
    // ignore
  }

  if (token) {
    try {
      await fetch(`${API_BASE}/api/loyalty/push/deregister`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token }),
      });
    } catch {
      // ignore
    }
  }

  await AsyncStorage.removeItem(STORED_TOKEN_KEY).catch(() => {});
}
