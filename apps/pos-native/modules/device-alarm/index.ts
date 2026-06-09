import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * Native handle for the on-device alert player. Plays the chime/alarm as
 * ALARM-class audio (AudioAttributes.USAGE_ALARM) so Android keeps them on the
 * SUNMI's built-in speaker even while a Bluetooth speaker is connected for
 * music (media audio still routes to BT; alarm audio stays on the device).
 *
 * Optional: where the native module isn't compiled in (Expo Go / dev / an
 * older APK that predates it) this is null and callers fall back to the
 * expo-audio media player (lib/chime.ts).
 */
export type DeviceAlarmModule = {
  /** Soft new-order bell, on the device alarm stream. */
  playChime(): void;
  /** Urgent serving-overdue alert, on the device alarm stream. */
  playAlarm(): void;
};

const DeviceAlarm = requireOptionalNativeModule<DeviceAlarmModule>("DeviceAlarm");

export default DeviceAlarm;
