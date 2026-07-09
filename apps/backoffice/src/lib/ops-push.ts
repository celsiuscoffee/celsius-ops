// Expo push for the ops workspace.
//
// Secondary delivery channel that mirrors every proactive WhatsApp send (see
// sendProactive in ops-pulse/sender) to the recipient's staff-native devices,
// so reminders, instructions, the scoreboard and digests all surface as phone
// notifications too. Best-effort by design: a push failure must NEVER break or
// delay the WhatsApp send, which stays the source of truth.
//
// Tokens live in hr_push_tokens, keyed by user_id (the native app registers
// them on login, apps/staff/src/app/api/staff/push/register). The Expo push
// API (exp.host) needs no credentials, we just POST the ExponentPushToken
// messages.

import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { samePhone } from "@/lib/ops-pulse/inbound";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// One entry in the Expo push API's response array (per message).
type ExpoReceipt = { status?: string; details?: { error?: string } };

export type OpsPushInput = {
  // Preferred: the recipient's user id. When absent we resolve the phone
  // against the staff directory (same normalised match as inbound WhatsApp).
  userId?: string | null;
  phone?: string | null;
  kind: string; // classification, drives native tap-routing (data.kind)
  title: string;
  body: string;
};

// Resolve a phone number to a staff user id. Phones are stored in varied
// formats (+60.../01...), so match on the last-9-digits rule used elsewhere.
async function userIdByPhone(phone: string): Promise<string | null> {
  const staff = await prisma.user.findMany({
    where: { status: "ACTIVE", phone: { not: null } },
    select: { id: true, phone: true },
  });
  const hit = staff.find((u) => u.phone && samePhone(phone, u.phone));
  return hit?.id ?? null;
}

// POST identical-content messages to Expo, one per token, chunked at 100 (the
// per-request cap). Tokens Expo reports as DeviceNotRegistered are marked
// inactive so we stop pushing to dead installs.
async function postToExpo(
  tokens: string[],
  msg: { title: string; body: string; data: Record<string, string> },
): Promise<void> {
  const valid = tokens.filter((t) => t?.startsWith("ExponentPushToken["));
  if (!valid.length) return;

  const CHUNK = 100;
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const messages = chunk.map((to) => ({
      to,
      title: msg.title,
      body: msg.body,
      sound: "default",
      data: msg.data,
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        console.warn(`[ops-push] expo HTTP ${res.status}`);
        continue;
      }
      let json: { data?: ExpoReceipt[] } | null = null;
      try {
        json = (await res.json()) as { data?: ExpoReceipt[] };
      } catch {
        json = null;
      }
      const dead: string[] = [];
      (json?.data ?? []).forEach((r: ExpoReceipt, idx: number) => {
        if (r?.details?.error === "DeviceNotRegistered") dead.push(chunk[idx]);
      });
      if (dead.length) {
        await supabaseAdmin
          .from("hr_push_tokens")
          .update({ is_active: false })
          .in("token", dead);
      }
    } catch (e) {
      console.warn("[ops-push] expo send failed", e);
    }
  }
}

// Send one ops push to a recipient's active devices. Never throws, returns the
// number of devices targeted (0 = recipient not on the app / no active token).
export async function sendOpsPush(input: OpsPushInput): Promise<number> {
  try {
    let userId = input.userId ?? null;
    if (!userId && input.phone) userId = await userIdByPhone(input.phone);
    if (!userId) return 0;

    const { data: rows } = await supabaseAdmin
      .from("hr_push_tokens")
      .select("token")
      .eq("user_id", userId)
      .eq("is_active", true);

    const tokens = (rows ?? [])
      .map((r) => r.token as string)
      .filter(Boolean);
    if (!tokens.length) return 0;

    await postToExpo(tokens, {
      title: input.title,
      body: input.body,
      data: { kind: input.kind },
    });
    return tokens.length;
  } catch (e) {
    console.warn("[ops-push] failed", e);
    return 0;
  }
}
