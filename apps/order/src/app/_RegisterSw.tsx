"use client";

import { useEffect } from "react";
import { registerForPush } from "@/lib/web-push-client";

/**
 * Registers /sw.js for the whole app. This registration used to live in the
 * Expo SPA shell's inline <script> (public/index.html) — now that the shell
 * is gone, the Next.js layout owns it. Keeping the SW registered matters for
 * two live features:
 *   - web push: loyalty pushes go to subscribers registered against /sw.js;
 *   - cache flush: mounting the v46 SW purges the retired Expo bundle from
 *     installed PWAs (see public/sw.js).
 */
export function RegisterSw() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => {
        // Silent subscription refresh for browsers that already granted
        // notifications (the Expo shell did this on every boot). Never
        // prompts — first-time opt-in stays on the Settings toggle.
        void registerForPush({ prompt: false });
      })
      .catch(() => {
        /* non-fatal — the app works without a SW */
      });
  }, []);
  return null;
}
