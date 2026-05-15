import { NextRequest, NextResponse } from "next/server";
import { evaluatePromotions, type CartLine } from "@/lib/loyalty/promotions";

// POST /api/loyalty/promotions/evaluate
//
// Returns the same shape as the loyalty app's /api/promotions/evaluate
// but routed through `evaluatePromotions()` in lib/loyalty/promotions
// so the response includes the tier % post-step. The previous version
// was a raw proxy that skipped the tier layering — the customer would
// see "RM14.90 total" at checkout (no tier %), then the order route
// would re-evaluate WITH the tier layer and store a smaller total,
// producing a confusing preview ↔ receipt mismatch on Silver / Gold /
// Platinum / Staff / Black Card members.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      lines?: CartLine[];
      member_id?: string | null;
      outlet_id?: string | null;
      member_tier_id?: string | null;
    };

    const result = await evaluatePromotions({
      lines: body.lines ?? [],
      member_id: body.member_id ?? null,
      outlet_id: body.outlet_id ?? null,
      member_tier_id: body.member_tier_id ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("promotions/evaluate proxy error:", err);
    return NextResponse.json(
      { error: "Failed to evaluate promotions" },
      { status: 500 }
    );
  }
}
