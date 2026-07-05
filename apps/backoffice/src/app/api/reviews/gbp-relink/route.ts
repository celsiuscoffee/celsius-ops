import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { requireRole } from "@/lib/auth";
import { relinkGbpLocations } from "@/lib/reviews/relink";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/reviews/gbp-relink[?apply=1] — audit (and with apply=1, repair) each
// outlet's gbpLocationName against the GBP account's own location list, matched
// by Places id (see lib/reviews/relink.ts for why placeId is the anchor).
// Dry-run by default; nothing outside ReviewSettings.gbpLocationName is ever
// touched, and only for outlets where the stored value provably mismatches.
// The nightly reviews-daily-snapshot cron also runs the repair, so this route
// is for on-demand checks rather than the only fix path.
export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) {
    try {
      await requireRole(request.headers, "ADMIN");
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const apply = new URL(request.url).searchParams.get("apply") === "1";

  const { checked, repaired, results } = await relinkGbpLocations(apply);
  if (checked === 0) {
    return NextResponse.json({ ok: true, checked, note: "No outlets with gbpAccountId + gbpPlaceId" });
  }
  return NextResponse.json({ ok: true, mode: apply ? "apply" : "dry_run", checked, repaired, results });
}
