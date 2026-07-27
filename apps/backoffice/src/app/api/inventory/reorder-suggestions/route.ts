import { NextResponse, NextRequest } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { computeReorderSuggestions } from "@/lib/inventory/reorder-suggestions";

// GET /api/inventory/reorder-suggestions
// Items at/below their reorder point with NO open PO already covering them, grouped
// into a suggested DRAFT PO per (cheapest active supplier × outlet). The "Need
// ordering" workspace tab shows these for a human to review + create — the ASSIST
// counterpart to the exec's auto-ordering (suggest, don't auto-fire).
//
// The computation lives in lib/inventory/reorder-suggestions.ts so the
// procurement advisor agent reads the exact same suggestions.

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groups = await computeReorderSuggestions();
  return NextResponse.json({
    groups,
    supplierCount: groups.length,
    itemCount: groups.reduce((s, g) => s + g.items.length, 0),
  });
}
