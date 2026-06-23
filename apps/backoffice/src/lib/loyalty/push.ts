import { supabaseAdmin } from "@/lib/loyalty/supabase";

/**
 * Minimal Expo push client for the loop engine's push-preferred delivery.
 *
 * The Expo push API (exp.host) needs NO credentials to send — you POST the
 * ExponentPushTokens + messages and it routes to APNs/FCM. So the backoffice
 * can deliver push directly without the order app's keys. (Mirrors the sender
 * in apps/order/src/lib/push/send.ts; kept local so this change doesn't touch
 * the order app's working push module.)
 *
 * Tokens live member-scoped in `expo_push_tokens` (same DB).
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const PUSH_TITLE = "Celsius Coffee";

/** member_id → valid Expo tokens (a member may have several devices). */
export async function pushTokensByMember(memberIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const ids = [...new Set(memberIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 1000) {
    const { data } = await supabaseAdmin
      .from("expo_push_tokens")
      .select("member_id, token")
      .in("member_id", ids.slice(i, i + 1000));
    for (const r of (data ?? []) as Array<{ member_id: string | null; token: string | null }>) {
      if (!r.member_id || !r.token || !r.token.startsWith("ExponentPushToken[")) continue;
      const arr = map.get(r.member_id) ?? [];
      arr.push(r.token);
      map.set(r.member_id, arr);
    }
  }
  return map;
}

/** Push one message to all of a member's devices. Returns ok if >=1 delivered.
 *  Best-effort prunes tokens Expo reports as DeviceNotRegistered. */
export async function sendPushToTokens(tokens: string[], body: string): Promise<{ ok: boolean; error?: string }> {
  const messages = tokens
    .filter((t) => t.startsWith("ExponentPushToken["))
    .map((t) => ({ to: t, title: PUSH_TITLE, body, sound: "default" as const }));
  if (!messages.length) return { ok: false, error: "no tokens" };
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!res.ok) return { ok: false, error: `expo HTTP ${res.status}` };
    const json = (await res.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
    const tickets = json.data ?? [];
    const okCount = tickets.filter((t) => t.status === "ok").length;
    const dead = tickets
      .map((t, i) => (t.status !== "ok" && t.details?.error === "DeviceNotRegistered" ? messages[i].to : null))
      .filter((t): t is string => !!t);
    if (dead.length) {
      try { await supabaseAdmin.from("expo_push_tokens").delete().in("token", dead); } catch { /* best-effort */ }
    }
    return okCount > 0 ? { ok: true } : { ok: false, error: tickets[0]?.details?.error ?? "push failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "push error" };
  }
}
