import { NextRequest, NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { loadCashGenerated, type Cadence } from "@/lib/finance/cashflow";

// Cash-generated table at a Daily / Weekly / Monthly cadence, optionally
// scoped to a single bank account (last-4 suffix: 4384 = Celsius Coffee SB,
// 2644 = Conezion, 9345 = Tamarind). Monthly + all-accounts is the
// reconciled header-based figure that matches the cash-tracking
// spreadsheet; Daily/Weekly are summed from individual bank lines.
export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  const cadenceParam = (req.nextUrl.searchParams.get("cadence") ?? "MONTHLY").toUpperCase();
  const cadence: Cadence =
    cadenceParam === "DAILY" || cadenceParam === "WEEKLY" ? cadenceParam : "MONTHLY";
  const account = req.nextUrl.searchParams.get("account") || null;
  // interco=exclude strips inter-entity transfers (default includes them).
  const includeInterco = req.nextUrl.searchParams.get("interco") !== "exclude";

  try {
    const result = await loadCashGenerated(cadence, account, includeInterco);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[finance/cashflow/cash-generated]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cash-generated compute failed" },
      { status: 500 },
    );
  }
}
