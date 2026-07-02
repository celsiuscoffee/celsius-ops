import { NextRequest, NextResponse } from "next/server";
import { fetchLoyaltySnapshot } from "@/lib/loyalty-snapshot";
import { requirePosApiAuth } from "@/lib/pos-auth";

/**
 * GET /api/loyalty/snapshot?phone=+60xxx
 * GET /api/loyalty/snapshot?member_id=member-…
 *
 * Bundled member snapshot for the customer-display second screen.
 * Accepts either lookup mode — NFC URLs encode memberId directly so
 * we can skip the phone-variants matching round-trip.
 *
 * 404 when no member matches.
 */
export async function GET(req: NextRequest) {
  const { block } = await requirePosApiAuth(req, "pos/loyalty/snapshot");
  if (block) return block;

  const phone = req.nextUrl.searchParams.get("phone");
  const memberId = req.nextUrl.searchParams.get("member_id");
  if (!phone && !memberId) {
    return NextResponse.json({ error: "phone or member_id required" }, { status: 400 });
  }
  try {
    const snapshot = memberId
      ? await fetchLoyaltySnapshot({ kind: "memberId", value: memberId })
      : await fetchLoyaltySnapshot({ kind: "phone", value: phone! });
    if (!snapshot) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(snapshot);
  } catch (err) {
    console.error("[LOYALTY] snapshot error:", err);
    return NextResponse.json({ error: "snapshot_failed" }, { status: 500 });
  }
}
