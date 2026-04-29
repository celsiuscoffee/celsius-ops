import { NextRequest, NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { loadCashTrackingMatrix } from "@/lib/finance/cash-tracking";

// Returns the per-outlet × category × month matrix sourced from
// classified BankStatementLine rows. OWNER/ADMIN only — finance:* is
// gated at the role level upstream.

export async function GET(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); }
  catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  const sp = req.nextUrl.searchParams;
  const monthsBack = sp.get("months") ? parseInt(sp.get("months")!, 10) : 6;
  const outletIds = [
    ...sp.getAll("outlet"),
    ...sp.getAll("outletId"),
  ].filter(Boolean);
  const includeInterCo = sp.get("includeInterCo") !== "false";

  try {
    const matrix = await loadCashTrackingMatrix({ monthsBack, outletIds, includeInterCo });
    return NextResponse.json(matrix);
  } catch (err) {
    console.error("[finance/cash-tracking]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cash tracking compute failed" },
      { status: 500 },
    );
  }
}
