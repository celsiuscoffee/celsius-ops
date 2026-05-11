import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Low-level Expo Push API client. Handles batching (Expo accepts up
 * to 100 messages per request), surfaces failures back to the caller,
 * and lazily removes tokens that come back with `DeviceNotRegistered`
 * so the next blast doesn't try to deliver to dead devices.
 *
 * All higher-level senders (templates.ts) compose `sendExpoPush`.
 * Do not call the Expo HTTP endpoint directly from any other module.
 *
 * Doc reference: https://docs.expo.dev/push-notifications/sending-notifications/
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type ExpoMessage = {
  to:                  string;
  title:               string;
  body:                string;
  /** Custom data payload — parsed client-side. Use `type` to route
   *  to a specific screen / handler (e.g. type: "order_ready"). */
  data?:               Record<string, unknown>;
  sound?:              "default" | null;
  badge?:              number;
  channelId?:          string;
  /** iOS: deliver even if user has Focus on. Use sparingly. */
  priority?:           "default" | "normal" | "high";
  /** Collapse key — newer notifications with the same key replace
   *  older ones on the lock screen (e.g. order status updates). */
  categoryId?:         string;
  ttl?:                number;
};

export type ExpoTicket = {
  status:    "ok" | "error";
  id?:       string;
  message?:  string;
  details?:  { error?: string; expoPushToken?: string };
};

export type SendResult = {
  sent:    number;
  failed:  number;
  pruned:  number;
};

/**
 * Send a batch of Expo push messages. `messages` may be longer than
 * the per-request limit — they're chunked internally and the
 * results are aggregated.
 *
 * Auto-removes invalid tokens from `expo_push_tokens` when Expo
 * reports `DeviceNotRegistered`. Other failures are logged but
 * returned to the caller for visibility.
 */
export async function sendExpoPush(messages: ExpoMessage[]): Promise<SendResult> {
  // Filter out anything that isn't a real Expo token to avoid wasting
  // a round-trip on garbage data left in the DB.
  const valid = messages.filter(
    (m) => typeof m.to === "string" && m.to.startsWith("ExponentPushToken["),
  );
  if (valid.length === 0) return { sent: 0, failed: 0, pruned: 0 };

  const CHUNK = 100;
  let sent = 0;
  let failed = 0;
  const deadTokens = new Set<string>();

  for (let i = 0; i < valid.length; i += CHUNK) {
    const batch = valid.slice(i, i + CHUNK);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type":    "application/json",
          Accept:            "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        // Whole batch failed (rate limit, network, etc.) — count and
        // continue with the next batch.
        failed += batch.length;
        console.warn(`[push] batch HTTP ${res.status}`);
        continue;
      }

      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = json.data ?? [];

      tickets.forEach((t, idx) => {
        if (t.status === "ok") {
          sent++;
        } else {
          failed++;
          const tok = batch[idx]?.to;
          // The error code we care about for cleanup. Other errors
          // (e.g. MessageRateExceeded) are transient — keep the token.
          if (tok && t.details?.error === "DeviceNotRegistered") {
            deadTokens.add(tok);
          }
        }
      });
    } catch (err) {
      console.warn("[push] fetch error", err);
      failed += batch.length;
    }
  }

  // Prune dead tokens in one round-trip. Best-effort: errors here
  // don't propagate (next push attempt will simply re-detect them).
  let pruned = 0;
  if (deadTokens.size > 0) {
    try {
      const supabase = getSupabaseAdmin();
      const { count } = await supabase
        .from("expo_push_tokens")
        .delete({ count: "exact" })
        .in("token", Array.from(deadTokens));
      pruned = count ?? 0;
    } catch (err) {
      console.warn("[push] token prune failed", err);
    }
  }

  return { sent, failed, pruned };
}
