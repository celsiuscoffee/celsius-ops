import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "./env";
import { loadSession } from "./session";

const STORED_TOKEN_KEY = "celsius_staff_expo_push_token_v1";

export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const session = await loadSession();
  if (!session?.token) return null;

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

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants.easConfig as { projectId?: string } | undefined)?.projectId;

  let expoToken: string;
  try {
    const res = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    expoToken = res.data;
  } catch {
    return null;
  }

  const cached = await AsyncStorage.getItem(STORED_TOKEN_KEY).catch(() => null);
  const fingerprint = `${expoToken}::${session.userId}`;
  if (cached === fingerprint) return expoToken;

  try {
    const res = await fetch(`${API_BASE_URL}/api/staff/push/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        token: expoToken,
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version ?? null,
      }),
    });
    if (res.ok) {
      await AsyncStorage.setItem(STORED_TOKEN_KEY, fingerprint).catch(() => {});
    }
  } catch {}

  return expoToken;
}

export async function deregisterPush(): Promise<void> {
  let token: string | null = null;
  try {
    const cached = await AsyncStorage.getItem(STORED_TOKEN_KEY);
    if (cached) token = cached.split("::")[0] ?? null;
  } catch {}

  // Only forget the local fingerprint once the server actually deactivated the
  // token. Clearing it on a failed call (offline logout) left the token active
  // server-side with the client convinced it was gone, so the logged-out
  // device kept receiving the previous user's pushes indefinitely. Keeping the
  // fingerprint means the next launch's registerForPush re-syncs ownership
  // (the register route reassigns tokens by onConflict), and the next
  // successful deregister still cleans up.
  let serverOk = !token; // nothing registered → nothing to keep
  if (token) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/staff/push/deregister`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      serverOk = res.ok;
    } catch {}
  }

  if (serverOk) {
    await AsyncStorage.removeItem(STORED_TOKEN_KEY).catch(() => {});
  }
}
