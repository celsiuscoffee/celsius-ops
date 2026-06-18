/**
 * Order-alert sounds for the POS till speaker (SUNMI). Two cues:
 *   - chime  → a soft bell when a new external order lands (table / pickup /
 *              GrabFood) so staff away from the till notice.
 *   - alarm  → a more urgent warble when an order blows the serving-time target
 *              (pickup not marked ready / table not marked done within 10 min).
 *
 * Cues play on the SUNMI's BUILT-IN speaker via the native DeviceSpeaker
 * module — so order alerts are heard at the till even when room music is on a
 * paired Bluetooth speaker — falling back to expo-audio's media stream if the
 * native module isn't compiled in. Every call is fire-and-forget + fully
 * crash-safe — a sound must never be able to break the order / print flow.
 */
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import DeviceSpeaker from "@/modules/device-speaker";

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

/**
 * Fallback path — expo-audio on the media stream (which follows the active
 * output, i.e. Bluetooth/A2DP when a speaker is paired). Used only when the
 * native DeviceSpeaker module isn't compiled in.
 */
function playViaExpoAudio(sound: Sound): void {
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

function play(sound: Sound): void {
  // Preferred: native DeviceSpeaker forces the cue onto the SUNMI's BUILT-IN
  // speaker (USAGE_ALARM + setPreferredDevice), so it's heard at the till even
  // while room music plays over a paired Bluetooth speaker. Falls back to
  // expo-audio if the native module is missing — a cue can never go silent.
  if (DeviceSpeaker) {
    try {
      DeviceSpeaker.play(sound).catch((e) => {
        console.warn(`[sound] native play ${sound} failed → expo-audio`, e);
        playViaExpoAudio(sound);
      });
      return;
    } catch (e) {
      console.warn(`[sound] native play ${sound} threw → expo-audio`, e);
    }
  }
  playViaExpoAudio(sound);
}

/** Pre-create the players at mount so the first real sound has no decode lag. */
export function primeSounds(): void {
  getPlayer("chime");
  getPlayer("alarm");
}

// ONE shared speaker reservation for BOTH cues. The chime rings once (a previous
// double-ring restarted the shared native MediaPlayer mid-clip and staff heard a
// stutter). The native DeviceSpeaker drives a SINGLE MediaPlayer, so chime and
// alarm would otherwise cut each other off when they land together — "a new
// order chimes just as another goes overdue". With one reservation, whichever
// cue starts first holds the speaker for its clip; any cue — chime OR alarm —
// arriving within the window is dropped, never restarting the player mid-clip.
// Both clips are ~2.4s. A dropped alarm re-fires on its 5-min cadence; a dropped
// chime's order is still on screen — so nothing important is lost. Also coalesces
// a burst of orders (Grab + pickup + table together) into one clean ring.
// JS-only → ships over OTA, no asset/rebuild needed.
const SOUND_CLIP_MS = 2400;                  // chime.wav / alarm.wav length (~2.40s)
const SPEAKER_HOLD_MS = SOUND_CLIP_MS + 200; // + native prepare slack
let speakerBusyUntil = 0;
/** Soft bell — a new external order arrived. Rings once; dropped if the speaker
 *  is mid-cue (see shared reservation above). */
export function playChime(): void {
  const now = Date.now();
  if (now < speakerBusyUntil) return;
  speakerBusyUntil = now + SPEAKER_HOLD_MS;
  play("chime");
}
/** Urgent warble — an order is past the serving-time target. Same shared
 *  reservation: dropped if a cue is mid-play; its 5-min re-sound cadence means a
 *  dropped instance is re-tried shortly, so a real overdue order is never missed. */
export function playAlarm(): void {
  const now = Date.now();
  if (now < speakerBusyUntil) return;
  speakerBusyUntil = now + SPEAKER_HOLD_MS;
  play("alarm");
}

// Back-compat alias (use-order-chime imports primeChime).
export const primeChime = primeSounds;
