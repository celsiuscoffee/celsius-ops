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

/** Soft bell — a new external order arrived. Rings TWICE: the cue plays, then
 *  replays once the ~2.4s clip has finished so the two rings are distinct (a
 *  single play() can't overlap — native DeviceSpeaker restarts the MediaPlayer
 *  and the expo-audio path seeks to 0 — so we space them by the clip length).
 *  Works on both playback paths and ships over OTA, no asset/rebuild needed. */
const CHIME_REPEAT_MS = 2500; // chime clip is ~2.40s; small gap before ring #2
// Rapid-fire guard: coalesce chime triggers fired within this window into ONE
// cue. Defence-in-depth against a runaway loop machine-gunning the speaker (the
// intended double-ring below is scheduled via setTimeout→play, NOT playChime, so
// it is never throttled). 1.5s is well under the gap between distinct orders.
const CHIME_MIN_GAP_MS = 1500;
let lastChimeAt = 0;
export function playChime(): void {
  const now = Date.now();
  if (now - lastChimeAt < CHIME_MIN_GAP_MS) return;
  lastChimeAt = now;
  play("chime");
  setTimeout(() => play("chime"), CHIME_REPEAT_MS);
}
/** Urgent warble — an order is past the serving-time target. */
export function playAlarm(): void { play("alarm"); }

// Back-compat alias (use-order-chime imports primeChime).
export const primeChime = primeSounds;
