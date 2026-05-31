import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { Screen } from "../../components/Screen";
import { PageHeader } from "../../components/PageHeader";
import { SelfieCapture } from "../../components/SelfieCapture";
import { ApiError } from "../../lib/api";
import {
  getClockStatus,
  pingAttendance,
  postClockAction,
  type ClockStatus,
} from "../../lib/hr/clock";
import {
  ensureNotificationPermission,
  getLocationStatus,
  requestBackground,
  requestForeground,
  setupNotificationChannel,
} from "../../lib/hr/permissions";
import { startGeofencing } from "../../lib/hr/geofence";
import {
  authenticate as biometricAuth,
  getBiometricRequired,
} from "../../lib/biometric";

type GpsState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; coords: { latitude: number; longitude: number }; accuracy: number | null }
  | { kind: "denied" }
  | { kind: "error"; message: string };

export default function ClockScreen() {
  const [status, setStatus] = useState<ClockStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [gps, setGps] = useState<GpsState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [permsReady, setPermsReady] = useState(false);
  // Pending action — set when the user taps Clock In/Out and we open
  // the SelfieCapture modal. After the photo is captured we hand it
  // (plus the pending action) to submitClockAction.
  const [pendingAction, setPendingAction] = useState<
    "clock_in" | "clock_out" | null
  >(null);

  const refresh = useCallback(async () => {
    try {
      const s = await getClockStatus();
      setStatus(s);
      setStatusError(null);
    } catch (e) {
      setStatusError(e instanceof ApiError ? e.message : "Couldn't load status");
    }
  }, []);

  const refreshGps = useCallback(async () => {
    const p = await getLocationStatus();
    if (p.foreground !== "granted") {
      setGps({ kind: "denied" });
      return;
    }
    setGps({ kind: "loading" });
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setGps({
        kind: "ok",
        coords: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
        accuracy: loc.coords.accuracy ?? null,
      });
    } catch (e) {
      setGps({
        kind: "error",
        message: e instanceof Error ? e.message : "GPS failed",
      });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    (async () => {
      const p = await getLocationStatus();
      if (p.foreground === "granted") {
        setPermsReady(true);
        refreshGps();
      }
    })();
  }, [refreshGps]);

  useEffect(() => {
    if (!permsReady) return;
    if (!status?.geofence) return;
    void startGeofencing([status.geofence]);
  }, [permsReady, status?.geofence]);

  async function enableLocation() {
    const fg = await requestForeground();
    if (fg !== "granted") {
      Alert.alert(
        "Location needed",
        "Without location we can't auto clock you in. Open Settings to enable.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }
    const bg = await requestBackground();
    if (bg !== "granted") {
      Alert.alert(
        "Always-on location off",
        "Auto clock-in won't trigger when the app is closed. You can clock in manually here, or enable 'Always' in Settings.",
      );
    }
    await ensureNotificationPermission();
    await setupNotificationChannel();
    setPermsReady(true);
    refreshGps();
  }

  // Two-step flow:
  //  1. startClockAction — biometric gate (if enabled), then open the
  //     SelfieCapture modal. Defers the API call until we have a photo.
  //  2. submitClockAction — fires once the selfie comes back; sends the
  //     base64 photo + coords to /api/hr/clock. Server uploads to
  //     hr-photos and stamps clock_in_photo_url on the log.
  //
  //  Selfie is a HARD requirement now — there's no "skip" path. Audit
  //  trail relies on every clock-in/out having a photo.
  async function startClockAction(action: "clock_in" | "clock_out") {
    if (busy || pendingAction) return;
    if (await getBiometricRequired()) {
      const reason =
        action === "clock_in" ? "Confirm clock-in" : "Confirm clock-out";
      const ok = await biometricAuth(reason);
      if (!ok) return;
    }
    setPendingAction(action);
  }

  async function submitClockAction(
    action: "clock_in" | "clock_out",
    photoBase64: string,
  ) {
    setPendingAction(null);
    setBusy(true);
    try {
      const coords = gps.kind === "ok" ? gps.coords : null;
      await postClockAction(action, coords, photoBase64);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      await refresh();
      if (coords) void pingAttendance(coords, "foreground");
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => {},
      );
      Alert.alert(
        action === "clock_in" ? "Couldn't clock in" : "Couldn't clock out",
        e instanceof ApiError ? e.message : "Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const clockedIn = status?.activeLog != null;
  const zone = status?.geofence;
  const distance =
    zone && gps.kind === "ok"
      ? Math.round(
          haversineDistance(
            gps.coords.latitude,
            gps.coords.longitude,
            Number(zone.latitude),
            Number(zone.longitude),
          ),
        )
      : null;
  const inZone =
    zone && distance != null ? distance <= (zone.radius_meters ?? 150) : false;
  const canClockIn = !clockedIn && (!zone || inZone);

  return (
    <Screen>
      <PageHeader
        title="Clock"
        subtitle={
          status?.activeLog
            ? `Clocked in at ${formatTime(status.activeLog.clock_in)}`
            : "Not clocked in"
        }
      />

      {!permsReady ? (
        <View className="mt-8 rounded-3xl border border-border bg-surface p-5">
          <Text className="text-base font-display-medium text-espresso">
            Enable location for auto clock-in
          </Text>
          <Text className="mt-2 text-sm font-body text-muted-fg">
            We'll notify you to clock in when you arrive at your outlet — and
            to clock out when you leave. Location is checked at the outlet
            boundary only, never tracked continuously.
          </Text>
          <Pressable
            onPress={enableLocation}
            className="mt-5 h-12 items-center justify-center rounded-2xl bg-primary"
          >
            <Text className="text-base font-body-bold text-white">
              Enable location
            </Text>
          </Pressable>
        </View>
      ) : (
        <View className="mt-6 rounded-3xl border border-border bg-surface p-5">
          {gps.kind === "loading" ? (
            <View className="flex-row items-center gap-3">
              <ActivityIndicator />
              <Text className="text-sm text-muted-fg">Locating you…</Text>
            </View>
          ) : gps.kind === "ok" ? (
            <View>
              {zone ? (
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-body-semi text-muted">
                    Distance to {zone.name}
                  </Text>
                  <Text
                    className={`text-base font-display-medium ${
                      inZone ? "text-success" : "text-espresso"
                    }`}
                  >
                    {distance != null ? `${distance}m` : "—"}
                  </Text>
                </View>
              ) : (
                <Text className="text-sm text-muted-fg">
                  No geofence configured for your outlet. Ask your manager to
                  set one in BackOffice → HR → Geofence.
                </Text>
              )}
              {gps.accuracy ? (
                <Text className="mt-2 text-xs text-muted">
                  GPS accuracy ±{Math.round(gps.accuracy)}m
                </Text>
              ) : null}
            </View>
          ) : (
            <Text className="text-sm text-danger">
              {gps.kind === "denied"
                ? "Location permission denied."
                : `GPS error: ${gps.kind === "error" ? gps.message : ""}`}
            </Text>
          )}
        </View>
      )}

      {statusError ? (
        <Text className="mt-3 text-sm text-danger">{statusError}</Text>
      ) : null}

      <View className="mt-auto pb-4">
        {clockedIn ? (
          <Pressable
            onPress={() => startClockAction("clock_out")}
            disabled={busy}
            className={`h-16 items-center justify-center rounded-2xl ${
              busy ? "bg-espresso/50" : "bg-espresso"
            }`}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-lg font-body-bold text-white">
                Clock out
              </Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={() => startClockAction("clock_in")}
            disabled={busy || !canClockIn || gps.kind !== "ok"}
            className={`h-16 items-center justify-center rounded-2xl ${
              busy || !canClockIn || gps.kind !== "ok"
                ? "bg-primary/40"
                : "bg-primary"
            }`}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-lg font-body-bold text-white">
                {!canClockIn && zone ? "Get closer to clock in" : "Clock in"}
              </Text>
            )}
          </Pressable>
        )}
        <Text className="mt-3 text-center text-xs text-muted">
          Auto clock-in is {permsReady ? "on" : "off"}. We'll notify you at the
          outlet boundary.
        </Text>
      </View>

      {/* Selfie capture — full-screen modal. Cancel returns to the
          clock screen without firing the API call; capture sends the
          base64 photo through submitClockAction. */}
      <Modal
        visible={pendingAction !== null}
        animationType="slide"
        onRequestClose={() => setPendingAction(null)}
        statusBarTranslucent
      >
        {pendingAction ? (
          <SelfieCapture
            prompt={
              pendingAction === "clock_in"
                ? "Take a selfie to clock in"
                : "Take a selfie to clock out"
            }
            onCancel={() => setPendingAction(null)}
            onCapture={(p) => submitClockAction(pendingAction, p.base64)}
          />
        ) : null}
      </Modal>
    </Screen>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
