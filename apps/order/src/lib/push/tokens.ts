import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Token lookup helpers. Higher-level senders (`templates.ts`) call
 * these to materialise the set of devices to deliver to for a given
 * scope (one customer, one order's customer, all customers, etc.).
 *
 * Tokens are stored member-scoped in `expo_push_tokens` — a single
 * row per device, keyed by `token`, with `member_id` + `phone` for
 * lookups. A customer who signs in on multiple devices has multiple
 * rows.
 */

export type PushToken = {
  token:       string;
  member_id:   string | null;
  phone:       string | null;
  platform:    string | null;
  app_version: string | null;
};

/** Tokens for a single customer phone (E.164). */
export async function tokensForPhone(phone: string): Promise<string[]> {
  if (!phone) return [];
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("expo_push_tokens")
    .select("token")
    .eq("phone", phone);
  return (data ?? [])
    .map((r) => (r as { token?: string }).token)
    .filter((t): t is string => !!t && t.startsWith("ExponentPushToken["));
}

/** Tokens for a single member_id. Use when the phone may have
 *  been anonymised (e.g. after account deletion edge cases). */
export async function tokensForMember(memberId: string): Promise<string[]> {
  if (!memberId) return [];
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("expo_push_tokens")
    .select("token")
    .eq("member_id", memberId);
  return (data ?? [])
    .map((r) => (r as { token?: string }).token)
    .filter((t): t is string => !!t && t.startsWith("ExponentPushToken["));
}

/** Tokens for the customer who placed a given order. Reads the
 *  order's loyalty_phone (preferred) or customer_phone. */
export async function tokensForOrder(orderId: string): Promise<string[]> {
  if (!orderId) return [];
  const supabase = getSupabaseAdmin();
  const { data: order } = await supabase
    .from("orders")
    .select("loyalty_phone, customer_phone")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return [];
  const phone = (order as { loyalty_phone?: string | null; customer_phone?: string | null }).loyalty_phone
    ?? (order as { customer_phone?: string | null }).customer_phone
    ?? "";
  return phone ? tokensForPhone(phone) : [];
}

/** ALL Expo tokens in the system. Use only for explicit broadcasts
 *  (admin-gated `/api/push/expo-blast`). Never call from a per-event
 *  trigger — it spams everyone. */
export async function tokensForBroadcast(): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("expo_push_tokens").select("token");
  return (data ?? [])
    .map((r) => (r as { token?: string }).token)
    .filter((t): t is string => !!t && t.startsWith("ExponentPushToken["));
}
