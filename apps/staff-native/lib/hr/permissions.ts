import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export type LocationStatus = {
  foreground: Location.PermissionStatus;
  background: Location.PermissionStatus;
  servicesEnabled: boolean;
};

export async function getLocationStatus(): Promise<LocationStatus> {
  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  return {
    foreground: fg.status,
    background: bg.status,
    servicesEnabled,
  };
}

export async function requestForeground(): Promise<Location.PermissionStatus> {
  const res = await Location.requestForegroundPermissionsAsync();
  return res.status;
}

export async function requestBackground(): Promise<Location.PermissionStatus> {
  const res = await Location.requestBackgroundPermissionsAsync();
  return res.status;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (current.canAskAgain) {
    const next = await Notifications.requestPermissionsAsync();
    return next.granted;
  }
  return false;
}

export async function setupNotificationChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("attendance", {
    name: "Attendance",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    enableVibrate: true,
  });
}
