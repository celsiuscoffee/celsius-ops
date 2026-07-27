import { NextRequest, NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { loadDailyRunRate } from "@/lib/finance/cashflow";

// Average cash in / out / net per calendar day from actual bank flows over a
// trailing window (default 90 days), split weekday vs weekend. External only
// (inter-entity transfers excluded). This is the daily run-rate behind the
// "≈ RM10.6k/day cash in" headline, and the weekday/weekend split shows where
// the business actually generates vs burns cash. Optional ?account=4384 scopes
// to one bank account; ?days=NN overrides the window (14–365).
export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  const account = req.nextUrl.searchParams.get("account") || null;
  const daysRaw = Number(req.nextUrl.searchParams.get("days") ?? 90);
  const days = Number.isFinite(daysRaw) ? Math.min(365, Math.max(14, Math.trunc(daysRaw))) : 90;

  try {
    const runRate = await loadDailyRunRate(account, days);
    return NextResponse.json({ runRate });
  } catch (err) {
    console.error("[finance/cashflow/daily-averages]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Daily run-rate compute failed" },
      { status: 500 },
    );
  }
}
