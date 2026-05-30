package com.celsiuscoffee.customerdisplay

import android.app.Presentation
import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Display
import android.view.ViewGroup
import android.widget.FrameLayout

import com.facebook.react.ReactApplication
import com.facebook.react.interfaces.fabric.ReactSurface

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Renders the customer-facing screen on the SUNMI D3's SECOND physical
 * display, full-screen — instead of letting Android mirror the cashier
 * register onto it.
 *
 * It hosts a Fabric ReactSurface for a SECOND registered React root
 * ("customerDisplay", see lib/register-customer-display.tsx) inside an
 * Android Presentation. Because that surface runs on the SAME JS runtime
 * as the register, the customer-display reads the very same zustand
 * stores (cart + display) — zero-latency mirror, no network bridge.
 *
 * The old Capacitor POS proved the D3 exposes its 2nd screen as a
 * presentation display; here we render a native React surface on it
 * rather than a WebView.
 */
class CustomerDisplayModule : Module() {

  private val TAG = "CustomerDisplay"
  private val main = Handler(Looper.getMainLooper())
  private var presentation: Presentation? = null
  private var surface: ReactSurface? = null
  private var displayListener: DisplayManager.DisplayListener? = null

  override fun definition() = ModuleDefinition {
    Name("CustomerDisplay")

    OnCreate { registerDisplayListener() }
    OnDestroy {
      unregisterDisplayListener()
      main.post { dismissInternal() }
    }

    // Called from JS once fonts are loaded + the outlet is known.
    AsyncFunction("present") { main.post { presentInternal() } }
    AsyncFunction("dismiss") { main.post { dismissInternal() } }
    AsyncFunction("isPresenting") { presentation?.isShowing == true }
  }

  private fun dm(): DisplayManager? {
    val ctx = appContext.reactContext ?: return null
    return ctx.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
  }

  private fun registerDisplayListener() {
    val manager = dm() ?: return
    val listener = object : DisplayManager.DisplayListener {
      override fun onDisplayAdded(displayId: Int) { main.post { presentInternal() } }
      override fun onDisplayRemoved(displayId: Int) { main.post { dismissInternal() } }
      override fun onDisplayChanged(displayId: Int) {}
    }
    manager.registerDisplayListener(listener, main)
    displayListener = listener
  }

  private fun unregisterDisplayListener() {
    val l = displayListener ?: return
    dm()?.unregisterDisplayListener(l)
    displayListener = null
  }

  private fun presentInternal() {
    try {
      val ctx = appContext.reactContext ?: return
      val manager = dm() ?: return
      val displays = manager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)
      if (displays.isEmpty()) {
        Log.i(TAG, "No presentation display attached")
        return
      }
      val display: Display = displays[0]

      // Already showing on this display → nothing to do.
      if (presentation?.isShowing == true && presentation?.display?.displayId == display.displayId) return
      dismissInternal()

      val reactHost = (ctx.applicationContext as? ReactApplication)?.reactHost
      if (reactHost == null) {
        Log.e(TAG, "ReactHost unavailable")
        return
      }

      val pres = Presentation(ctx, display)
      val container = FrameLayout(pres.context)
      container.layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
      )

      // Fabric surface for the second JS root, rendered with the
      // presentation's (secondary-display) context.
      val s = reactHost.createSurface(pres.context, "customerDisplay", null)
      s.start()
      s.view?.let { v ->
        v.layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
        )
        container.addView(v)
      }

      pres.setContentView(container)
      pres.setOnDismissListener { /* system reclaimed the display */ }
      pres.show()

      presentation = pres
      surface = s
      Log.i(TAG, "Customer display presented on display ${display.displayId}")
    } catch (e: Exception) {
      Log.e(TAG, "presentInternal failed: ${e.message}", e)
    }
  }

  private fun dismissInternal() {
    try {
      surface?.stop()
    } catch (e: Exception) {
      Log.w(TAG, "surface stop: ${e.message}")
    }
    surface = null
    try {
      presentation?.dismiss()
    } catch (e: Exception) {
      Log.w(TAG, "presentation dismiss: ${e.message}")
    }
    presentation = null
  }
}
