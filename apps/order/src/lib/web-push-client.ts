"use client";

/**
 * Web-push subscribe for the Next.js webapp. Ported from the retired Expo
 * shell's lib/notifications.web.ts (apps/pickup-native) — that shell was the
 * only place the web ever called pushManager.subscribe(), so when it stopped
 * shipping, new web subscriptions would have silently ended. The settings
 * toggle and the boot-time refresh below now own that job.
 *
 * POSTs the PushSubscription to /api/push/subscribe (endpoint-keyed upsert
 * into push_subscriptions — the audience for the loyalty push crons).
 */

const STORED_ENDPOINT_KEY = "celsius-web-push-endpoint-v1";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer as ArrayBuffer;
}

export function isBrowserPushReady(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Ensure this browser is subscribed and the server knows the endpoint.
 * `prompt: false` (the boot-time path) never shows the permission dialog —
 * it only refreshes an already-granted browser. Returns the endpoint on
 * success, null otherwise.
 */
export async function registerForPush({ prompt }: { prompt: boolean }): Promise<string | null> {
  if (!isBrowserPushReady()) return null;
  if (!VAPID_PUBLIC_KEY) {
    console.warn("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set; skipping web push");
    return null;
  }

  let perm = Notification.permission;
  if (perm === "default" && prompt) {
    try {
      perm = await Notification.requestPermission();
    } catch {
      return null;
    }
  }
  if (perm !== "granted") return null;

  // <RegisterSw /> registers /sw.js from the root layout; wait for it.
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg) return null;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    } catch (err) {
      console.warn("[push] subscribe failed:", err);
      return null;
    }
  }

  // Don't re-POST an endpoint the server already has (survives reloads).
  const cached = (() => {
    try {
      return window.localStorage.getItem(STORED_ENDPOINT_KEY);
    } catch {
      return null;
    }
  })();
  if (cached === sub.endpoint) return sub.endpoint;

  try {
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    if (res.ok) {
      try {
        window.localStorage.setItem(STORED_ENDPOINT_KEY, sub.endpoint);
      } catch {
        /* cache is an optimisation only */
      }
    }
  } catch (err) {
    console.warn("[push] subscribe POST failed:", err);
  }

  return sub.endpoint;
}
