import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { API_BASE_URL } from "../env";

export const GEOFENCE_TASK = "celsius-staff-geofence-v1";

const SESSION_KEY = "celsius_staff_session_v1";
const GEOFENCE_THROTTLE_KEY = "celsius_staff_geofence_throttle_v1";

// Collapse geofence "flapping". When a device sits near the ~100m outlet
// boundary (or GPS accuracy is poor), the OS toggles Enter/Exit repeatedly and
// each event used to fire its own notification — producing the clock-in /
// clock-out prompt spam staff were seeing (dozens of alternating "You're at" /
// "You left" banners minutes apart). We suppress a repeat prompt for the same
// outlet + direction inside this window. 30 min matches the server's default
// geofence_exit_grace_minutes (see the attendance ping route): a staff member
// never needs to be re-prompted to clock in/out more than twice an hour, and a
// real arrival/departure an hour later still gets through.
const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;

type ThrottleState = Record<string, { enter?: number; exit?: number }>;

// Returns true if a notification for this outlet + direction should fire now,
// recording the timestamp when it does. Storage failures fall back to notifying
// so a genuine arrival is never silently swallowed (the pre-throttle behaviour).
async function shouldNotify(
  identifier: string,
  direction: "enter" | "exit",
  now: number,
): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(GEOFENCE_THROTTLE_KEY);
    const state: ThrottleState = raw ? JSON.parse(raw) : {};
    const last = state[identifier]?.[direction];
    if (last != null && now - last < NOTIFY_COOLDOWN_MS) return false;
    state[identifier] = { ...state[identifier], [direction]: now };
    await AsyncStorage.setItem(GEOFENCE_THROTTLE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return true;
  }
}

type SessionShape = { token?: string } | null;

async function getToken(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionShape;
    return parsed?.token ?? null;
  } catch {
    return null;
  }
}

async function fireNotification(title: string, body: string, data: Record<string, unknown>) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: "default",
      },
      trigger: null,
    });
  } catch {}
}

async function backgroundPing(
  source: "background" | "push_wake",
  lat?: number,
  lng?: number,
) {
  // Prefer the DEVICE's actual position over whatever coords the caller passed.
  // Geofence events hand us the region (outlet) center, so pinging with those
  // always reads in_zone and the server never sees a real out-of-zone ping,
  // defeating geofence-exit detection. Fall back to the passed coords only if a
  // fresh fix isn't available.
  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    lat = loc.coords.latitude;
    lng = loc.coords.longitude;
  } catch {
    // keep the passed-in coords as a last resort
  }
  if (lat == null || lng == null) return;
  const token = await getToken();
  if (!token) return;
  try {
    await fetch(`${API_BASE_URL}/api/hr/attendance/ping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ lat, lng, source }),
    });
  } catch {}
}

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { eventType, region } = data as {
    eventType: Location.GeofencingEventType;
    region: Location.LocationRegion & { identifier: string };
  };
  const outletName = region.identifier.replace(/^outlet:/, "");

  if (eventType === Location.GeofencingEventType.Enter) {
    if (await shouldNotify(region.identifier, "enter", Date.now())) {
      await fireNotification(
        `You're at ${outletName}`,
        "Tap to clock in for today's shift.",
        { kind: "geofence_enter", outletId: region.identifier, action: "clock_in" },
      );
    }
    void backgroundPing("background", region.latitude, region.longitude);
  } else if (eventType === Location.GeofencingEventType.Exit) {
    if (await shouldNotify(region.identifier, "exit", Date.now())) {
      await fireNotification(
        `You left ${outletName}`,
        "Tap to clock out if your shift is done.",
        { kind: "geofence_exit", outletId: region.identifier, action: "clock_out" },
      );
    }
    void backgroundPing("background", region.latitude, region.longitude);
  }
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

if (Platform.OS === "android") {
  void Notifications.setNotificationChannelAsync("attendance", {
    name: "Attendance",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    enableVibrate: true,
  });
}
