/**
 * Order-alert sounds for the POS till speaker (SUNMI). Two cues:
 *   - chime  → a soft bell when a new external order lands (table / pickup /
 *              GrabFood) so staff away from the till notice.
 *   - alarm  → a more urgent warble when an order blows the serving-time target
 *              (pickup not marked ready / table not marked done within 10 min).
 *
 * Plays on the Android media stream, so the till's media volume must be up.
 * Every call is fire-and-forget + fully crash-safe — a sound must never be able
 * to break the order / print flow.
 */
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import DeviceAlarm from "device-alarm";

type Sound = "chime" | "alarm";

const SOURCES: Record<Sound, number> = {
  chime: require("../assets/chime.wav"),
  alarm: require("../assets/alarm.wav"),
};

const players: Partial<Record<Sound, AudioPlayer | null>> = {};
const failed: Partial<Record<Sound, boolean>> = {};

function getPlayer(sound: Sound): AudioPlayer | null {
  if (players[sound] || failed[sound]) return players[sound] ?? null;
  try {
    const p = createAudioPlayer(SOURCES[sound]);
    p.volume = 1.0;
    players[sound] = p;
  } catch (e) {
    failed[sound] = true;
    console.warn(`[sound] init ${sound} failed`, e);
  }
  return players[sound] ?? null;
}

function play(sound: Sound): void {
  // Prefer the native ALARM-class player: it keeps the alert on the SUNMI's
  // built-in speaker even when a Bluetooth speaker is connected (so cafe music
  // can play to BT while order alerts stay at the till). Falls through to the
  // expo-audio media player below where the native module isn't present
  // (Expo Go / an APK that predates it) — media routes to BT as before.
  if (DeviceAlarm) {
    try {
      if (sound === "chime") DeviceAlarm.playChime();
      else DeviceAlarm.playAlarm();
      return;
    } catch (e) {
      console.warn(`[sound] native ${sound} failed, falling back`, e);
    }
  }
  const p = getPlayer(sound);
  if (!p) return;
  try {
    // Rewind first so a repeat still gets the full sound even if the previous
    // play just finished; start once the seek lands.
    p.seekTo(0)
      .then(() => p.play())
      .catch(() => { try { p.play(); } catch { /* ignore */ } });
  } catch (e) {
    console.warn(`[sound] play ${sound} failed`, e);
  }
}

/** Pre-create the players at mount so the first real sound has no decode lag. */
export function primeSounds(): void {
  getPlayer("chime");
  getPlayer("alarm");
}

/** Soft bell — a new external order arrived. */
export function playChime(): void { play("chime"); }
/** Urgent warble — an order is past the serving-time target. */
export function playAlarm(): void { play("alarm"); }

// Back-compat alias (use-order-chime imports primeChime).
export const primeChime = primeSounds;
