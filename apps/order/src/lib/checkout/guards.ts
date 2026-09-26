/**
 * Server-side guards shared by the two order-creation routes
 * (/api/orders for the native app, /api/checkout/initiate for QR-table web).
 * Added after the 2026-09-25 security review, which found both routes taking
 * loyaltyId / loyaltyPhone / rewardId / walletVoucherId straight from the
 * request body with no session, and modifier prices from the client.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readCustomerSession } from "../customer-jwt";

/** Canonical digit form for comparing phones across the three spellings the
 *  codebase stores (+60…, 60…, 0…). Never used for storage, only equality. */
export function phoneDigits(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("60")) return d;
  if (d.startsWith("0")) return `6${d}`;
  return `60${d}`;
}

export const SESSION_REQUIRED_MESSAGE =
  "Your sign-in has expired. Sign in again under Account to earn Beans and use rewards, or remove the reward to order as a guest.";

export type LoyaltyBinding =
  | { ok: true; loyaltyId: string | null; loyaltyPhone: string | null }
  | { ok: false; response: NextResponse };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Bind the loyalty fields of an order to the caller's customer session.
 *
 * - No loyalty field at all → guest order, nothing to check.
 * - Any loyalty field without a valid Bearer → 401. This is deliberately
 *   strict regardless of STRICT_CUSTOMER_AUTH: with the body trusted, anyone
 *   could burn another member's points or vouchers by sending their id
 *   (member ids were enumerable by phone), or claim first-order discounts
 *   on invented phones.
 * - loyaltyPhone must match the session phone; loyaltyId must be the session
 *   member (by `sub`, or by the member row's phone when the token pre-dates
 *   the member row).
 * - Returns the ids to use downstream, filling from the session when the
 *   client only sent one of them.
 */
export async function bindLoyaltyToSession(
  request: NextRequest,
  supabase: SupabaseClient,
  input: { loyaltyId?: unknown; loyaltyPhone?: unknown; rewardId?: unknown; walletVoucherId?: unknown },
): Promise<LoyaltyBinding> {
  const loyaltyId = str(input.loyaltyId);
  const loyaltyPhone = str(input.loyaltyPhone);
  const wantsLoyalty = !!(loyaltyId || loyaltyPhone || str(input.rewardId) || str(input.walletVoucherId));
  if (!wantsLoyalty) return { ok: true, loyaltyId: null, loyaltyPhone: null };

  const session = readCustomerSession(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: SESSION_REQUIRED_MESSAGE, code: "SESSION_REQUIRED" },
        { status: 401 },
      ),
    };
  }
  const sessionDigits = phoneDigits(session.phone);
  const forbidden = (why: string) => ({
    ok: false as const,
    response: NextResponse.json({ error: why, code: "SESSION_MISMATCH" }, { status: 403 }),
  });

  if (loyaltyPhone && phoneDigits(loyaltyPhone) !== sessionDigits) {
    return forbidden("The phone on this order doesn't match your sign-in.");
  }

  let memberId: string | null = loyaltyId;
  if (loyaltyId && loyaltyId !== session.sub) {
    const { data: m } = await supabase
      .from("members")
      .select("phone")
      .eq("id", loyaltyId)
      .maybeSingle<{ phone: string | null }>();
    if (!m || phoneDigits(m.phone) !== sessionDigits) {
      return forbidden("This loyalty account doesn't belong to your sign-in.");
    }
  }
  if (!memberId) {
    // Reward / voucher / phone-only order: resolve the member from the
    // session so the reward resolver and the points ledger see a real id.
    memberId = session.sub || null;
    if (!memberId) {
      const d = sessionDigits;
      const { data: rows } = await supabase
        .from("members")
        .select("id")
        .in("phone", [`+${d}`, d, `0${d.slice(2)}`])
        .limit(1);
      memberId = (rows?.[0] as { id: string } | undefined)?.id ?? null;
    }
  }

  return { ok: true, loyaltyId: memberId, loyaltyPhone: loyaltyPhone ?? session.phone };
}

/** optionId → priceDelta in sen, from a product's `modifiers` JSON
 *  (groups[{ options[{ id, priceDelta }] }]). Tolerates any other shape. */
export function modifierPriceMap(modifiers: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(modifiers)) return map;
  for (const g of modifiers as Array<{ options?: unknown }>) {
    if (!Array.isArray(g?.options)) continue;
    for (const o of g.options as Array<{ id?: unknown; priceDelta?: unknown }>) {
      if (typeof o?.id !== "string") continue;
      const rm = Number(o.priceDelta ?? 0);
      map.set(o.id, Number.isFinite(rm) ? Math.max(0, Math.round(rm * 100)) : 0);
    }
  }
  return map;
}

/**
 * Sum of modifier upcharges for one line, in sen. A selection whose optionId
 * exists on the product is priced from the DB (the client's priceDelta is
 * ignored); an unknown optionId falls back to the client's value clamped to
 * >= 0, so a legacy selection can't break an order but can never lower it.
 * Accepts both client shapes: `[{ optionId, priceDelta }]` and
 * `{ selections: [...] }`.
 */
export function serverModifierDeltaSen(prices: Map<string, number>, modifiers: unknown): number {
  const selections: Array<{ optionId?: unknown; priceDelta?: unknown }> = Array.isArray(modifiers)
    ? modifiers
    : Array.isArray((modifiers as { selections?: unknown } | null)?.selections)
      ? ((modifiers as { selections: Array<{ optionId?: unknown; priceDelta?: unknown }> }).selections)
      : [];
  let sen = 0;
  for (const s of selections) {
    const known = typeof s?.optionId === "string" ? prices.get(s.optionId) : undefined;
    if (known != null) {
      sen += known;
    } else {
      const rm = Number(s?.priceDelta ?? 0);
      sen += Number.isFinite(rm) ? Math.max(0, Math.round(rm * 100)) : 0;
    }
  }
  return sen;
}

/** `C-` + 4 base36 chars of the ms clock + 2 random digits. Short enough for
 *  a receipt, sparse enough that a retry on collision is rare. */
export function generateOrderNumber(): string {
  return `C-${Date.now().toString(36).slice(-4).toUpperCase()}${Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Insert an order row, regenerating `order_number` on a unique-violation
 * (23505). `orders.order_number` is UNIQUE for all time; the old 4-digit
 * random number had a ~15% collision rate once 1,500 orders existed and
 * surfaced as a 500 to the customer.
 */
export async function insertOrderWithRetry(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
  attempts = 5,
): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> {
  let last: { code?: string; message?: string } | null = null;
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await supabase
      .from("orders")
      .insert({ ...row, order_number: generateOrderNumber() })
      .select()
      .single();
    if (!error) return { data, error: null };
    last = error;
    if (error.code !== "23505") break;
  }
  return { data: null, error: last };
}
