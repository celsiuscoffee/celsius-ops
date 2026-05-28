import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/loyalty/apply-promotions
 *
 * Records the promotions applied to a *completed* POS sale into the loyalty
 * engine's ledger by forwarding to the central /api/promotions/apply. This is
 * what makes per-customer / total usage limits actually enforce for POS sales:
 * the engine's evaluateCart reads promotion_applications, and only this call
 * writes it. Without it, every POS member can reuse a capped promo forever.
 *
 * Mirrors apps/order's recordPromotionApplications. Runs server-to-server with
 * CRON_SECRET — a server secret that must never reach the browser, which is why
 * this lives behind a POS route rather than being fired from the register UI.
 *
 * Best-effort: the sale is already committed, so a ledger hiccup must never
 * surface to the cashier. The caller fires this fire-and-forget.
 *
 * Body: { reference_id, lines, member_id?, outlet_id?, member_tier_id?,
 *         promo_code?, reward_promotion_ids? }
 */

const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();
const BRAND_ID = "brand-celsius";
const CRON_SECRET = (process.env.CRON_SECRET ?? "").trim();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (typeof body.reference_id !== "string" || !Array.isArray(body.lines)) {
      return NextResponse.json({ error: "reference_id + lines required" }, { status: 400 });
    }

    // The apply endpoint authenticates with the shared CRON_SECRET. Without it
    // the call would 401, so skip cleanly (limits stay unenforced until the
    // POS deployment sets CRON_SECRET) rather than spam failures.
    if (!CRON_SECRET) {
      return NextResponse.json({ skipped: "CRON_SECRET unset" });
    }

    const res = await fetch(`${LOYALTY_BASE}/api/promotions/apply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The engine's CSRF middleware allowlists celsiuscoffee.com — any
        // other Origin gets a silent 403.
        Origin: "https://celsiuscoffee.com",
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify({
        brand_id: BRAND_ID,
        reference_id: body.reference_id,
        lines: body.lines,
        member_id: body.member_id ?? null,
        outlet_id: body.outlet_id ?? null,
        member_tier_id: body.member_tier_id ?? null,
        promo_code: body.promo_code ?? null,
        reward_promotion_ids: body.reward_promotion_ids ?? [],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[POS] apply-promotions: engine returned", res.status, text.slice(0, 200));
      return NextResponse.json({ ok: false, status: res.status }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POS] apply-promotions:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "apply failed" },
      { status: 500 },
    );
  }
}
