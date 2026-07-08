import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { API_BASE_URL } from "../env";

export const GEOFENCE_TASK = "celsius-staff-geofence-v1";

const SESSION_KEY = "celsius_staff_session_v1";

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
    await fireNotification(
      `You're at ${outletName}`,
      "Tap to clock in for today's shift.",
      { kind: "geofence_enter", outletId: region.identifier, action: "clock_in" },
    );
    void backgroundPing("background", region.latitude, region.longitude);
  } else if (eventType === Location.GeofencingEventType.Exit) {
    await fireNotification(
      `You left ${outletName}`,
      "Tap to clock out if your shift is done.",
      { kind: "geofence_exit", outletId: region.identifier, action: "clock_out" },
    );
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
