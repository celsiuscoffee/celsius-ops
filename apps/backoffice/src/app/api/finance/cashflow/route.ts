import { NextRequest, NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { computeCashflow } from "@/lib/finance/cashflow";

export async function GET(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); }
  catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  const weeksParam = req.nextUrl.searchParams.get("weeks");
  // Accept either ?outletId=X (legacy single) or repeated ?outlet=X for
  // multi-filter — same convention used by /api/inventory/invoices.
  const outletIds = [
    ...req.nextUrl.searchParams.getAll("outlet"),
    ...req.nextUrl.searchParams.getAll("outletId"),
  ].filter(Boolean);
  const weeks = weeksParam ? parseInt(weeksParam, 10) : 8;

  try {
    const result = await computeCashflow({ weeks, outletIds });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[finance/cashflow]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cashflow compute failed" },
      { status: 500 },
    );
  }
}
