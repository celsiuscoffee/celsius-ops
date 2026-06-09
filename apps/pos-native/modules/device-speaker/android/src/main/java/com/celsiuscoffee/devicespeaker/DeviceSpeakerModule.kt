package com.celsiuscoffee.devicespeaker

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.util.Log

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo native module: play short order-alert cues on the SUNMI's BUILT-IN
 * speaker, independent of any A2DP / Bluetooth media route.
 *
 * Why native: when a Bluetooth speaker is paired (the cafe plays music over
 * it), Android routes all *media* audio — including expo-audio — to A2DP, so
 * the chime/alarm would blast through the room music instead of the till.
 * Here we:
 *   1. tag the cue as USAGE_ALARM / CONTENT_TYPE_SONIFICATION — alarms stay
 *      on the device speaker on most Android builds even with A2DP up; and
 *   2. explicitly pin the MediaPlayer output to TYPE_BUILTIN_SPEAKER via
 *      setPreferredDevice (API 23+) — belt-and-suspenders.
 *
 * Sounds live in this module's res/raw (chime.wav / alarm.wav). The JS side
 * (lib/chime.ts) calls play("chime"|"alarm") and falls back to expo-audio if
 * this module isn't compiled in.
 */
class DeviceSpeakerModule : Module() {

  private val TAG = "DeviceSpeaker"
  private var player: MediaPlayer? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("DeviceSpeaker")

    AsyncFunction("play") { sound: String ->
      playOnBuiltin(sound)
    }

    AsyncFunction("stop") {
      release()
    }

    OnDestroy {
      release()
    }
  }

  private fun playOnBuiltin(sound: String) {
    val name = if (sound == "alarm") "alarm" else "chime"
    val resId = context.resources.getIdentifier(name, "raw", context.packageName)
    if (resId == 0) {
      Log.w(TAG, "raw resource '$name' not found")
      return
    }

    release()

    val mp = MediaPlayer()
    player = mp
    try {
      mp.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      context.resources.openRawResourceFd(resId).use { afd ->
        mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
      }
      mp.setOnPreparedListener { p ->
        pinToBuiltinSpeaker(p)
        try { p.start() } catch (e: Exception) { Log.w(TAG, "start: ${e.message}") }
      }
      mp.setOnCompletionListener { releaseIf(it) }
      mp.setOnErrorListener { p, what, extra ->
        Log.e(TAG, "MediaPlayer error $what/$extra")
        releaseIf(p)
        true
      }
      mp.prepareAsync()
    } catch (e: Exception) {
      Log.e(TAG, "playOnBuiltin('$name'): ${e.message}", e)
      release()
    }
  }

  /** Force this player's output to the device's built-in speaker (API 23+). */
  private fun pinToBuiltinSpeaker(mp: MediaPlayer) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    try {
      val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val builtin = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        .firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
      if (builtin != null) {
        val ok = mp.setPreferredDevice(builtin)
        Log.i(TAG, "pin built-in speaker = $ok")
      } else {
        Log.w(TAG, "no TYPE_BUILTIN_SPEAKER output device found")
      }
    } catch (e: Exception) {
      Log.w(TAG, "pinToBuiltinSpeaker: ${e.message}")
    }
  }

  private fun releaseIf(mp: MediaPlayer) {
    if (player === mp) release()
  }

  private fun release() {
    val p = player ?: return
    player = null
    try {
      if (p.isPlaying) p.stop()
    } catch (e: Exception) {
      Log.w(TAG, "stop: ${e.message}")
    }
    try {
      p.release()
    } catch (e: Exception) {
      Log.w(TAG, "release: ${e.message}")
    }
  }
}
