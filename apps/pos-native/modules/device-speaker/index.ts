import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * Native handle to DeviceSpeaker (Android-only).
 *
 * Plays the order-alert cues (chime / alarm) on the SUNMI's BUILT-IN speaker,
 * bypassing any Bluetooth/A2DP media route — so the till is heard even while
 * the room plays music over a paired Bluetooth speaker.
 *
 * Uses requireOptionalNativeModule so the app keeps running where the native
 * side isn't compiled in (Expo Go, the Metro web target, a non-SUNMI device).
 * Callers MUST null-check — lib/chime.ts does, and falls back to expo-audio.
 */
export type DeviceSpeakerModule = {
  /** Play a bundled cue on the built-in speaker. Resolves once playback starts. */
  play(sound: "chime" | "alarm"): Promise<void>;
  /** Stop any in-flight cue. */
  stop(): Promise<void>;
};

const DeviceSpeaker = requireOptionalNativeModule<DeviceSpeakerModule>("DeviceSpeaker");

export default DeviceSpeaker;
