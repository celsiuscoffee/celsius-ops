const API_BASE = "https://order.celsiuscoffee.com";

/**
 * Poster telemetry from the NATIVE app → /api/poster-tap.
 *
 * Until now only the WEB home carousel logged poster taps, so the autopilot's
 * "measured AOV" learning signal (poster_events → pos_poster_app_perf) was
 * blind to the flagship surface, and the splash placement logged nothing at
 * all. Impressions give taps a denominator (poster CTR).
 *
 * Fire-and-forget: telemetry must never delay a tap or the splash timer.
 */
export function logPosterEvent(args: {
  posterId: string;
  placement: "home" | "splash";
  eventType: "tap" | "impression";
  deeplink?: string | null;
  loyaltyId?: string | null;
}): void {
  try {
    void fetch(`${API_BASE}/api/poster-tap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: API_BASE,
        Referer: API_BASE + "/",
      },
      body: JSON.stringify({
        posterId: args.posterId,
        placement: args.placement,
        eventType: args.eventType,
        deeplink: args.deeplink ?? null,
        loyaltyId: args.loyaltyId ?? null,
      }),
    }).catch(() => {});
  } catch {
    // never let telemetry surface to the UI
  }
}
