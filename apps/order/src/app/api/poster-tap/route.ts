import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { readCustomerSession } from "@/lib/customer-jwt";

/**
 * POST /api/poster-tap
 *
 * Logs a customer tap on a home/splash poster so the pos-poster-autopilot can
 * learn which poster drives orders / higher AOV. The member is taken from the
 * customer JWT when present (falls back to the body's loyaltyId). The product is
 * parsed from the deeplink (/product/<id>). At order creation,
 * attributeOrderToPoster tags the most recent unattributed tap for the member.
 *
 * Best-effort, never throws — a failed log must not affect the customer.
 */

export const dynamic = "force-dynamic";

const ROUNDS: { key: string; s: number; e: number }[] = [
  { key: "breakfast", s: 8, e: 10 }, { key: "brunch", s: 10, e: 12 }, { key: "lunch", s: 12, e: 15 },
  { key: "midday", s: 15, e: 17 }, { key: "evening", s: 17, e: 19 }, { key: "dinner", s: 19, e: 21 },
  { key: "supper", s: 21, e: 23 },
];
function currentRound(): string | null {
  const h = (new Date().getUTCHours() + 8) % 24; // MYT
  return ROUNDS.find((r) => h >= r.s && h < r.e)?.key ?? null;
}
function productIdFromDeeplink(dl: string | null): string | null {
  if (!dl) return null;
  const m = dl.match(/\/product\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      posterId?: string; placement?: string; deeplink?: string; loyaltyId?: string; sessionId?: string;
    };
    if (!body?.posterId) return NextResponse.json({ ok: false }, { status: 200 });

    const session = readCustomerSession(req);
    const loyaltyId =
      (session as { loyaltyId?: string } | null)?.loyaltyId ??
      (typeof body.loyaltyId === "string" ? body.loyaltyId : null);

    const supabase = getSupabaseAdmin();
    await supabase.from("poster_events").insert({
      poster_id: body.posterId,
      product_id: productIdFromDeeplink(typeof body.deeplink === "string" ? body.deeplink : null),
      placement: typeof body.placement === "string" ? body.placement : null,
      round: currentRound(),
      loyalty_id: loyaltyId,
      session_id: typeof body.sessionId === "string" ? body.sessionId : null,
      event_type: "tap",
    } as Record<string, unknown>);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
