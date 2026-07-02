import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { applyTermExclusion, rejectTermExclusion } from "@/lib/ads/exclude-term";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ads/paid-organic/exclude — THE approval gate for excluding a
// search term from a Smart campaign. Only an admin's explicit click reaches
// this endpoint; action "apply" writes the negative keyword theme to Google
// Ads, action "reject" just records the dismissal. Nothing else in the system
// mutates Google Ads.
// Body: { campaignId, searchTerm, action: "apply" | "reject",
//         estMonthlySavingMyr?, reason? }
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireRole(request.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const campaignId: string = body.campaignId;
  const searchTerm: string = (body.searchTerm || "").trim();
  const action: string = body.action;
  if (!campaignId || !searchTerm || !["apply", "reject"].includes(action)) {
    return NextResponse.json({ error: "campaignId, searchTerm and action (apply|reject) required" }, { status: 400 });
  }

  const decision = {
    campaignId,
    searchTerm,
    decidedBy: user.name || user.id,
    estMonthlySavingMyr: typeof body.estMonthlySavingMyr === "number" ? body.estMonthlySavingMyr : null,
    reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
  };

  if (action === "reject") {
    await rejectTermExclusion(decision);
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  const result = await applyTermExclusion(decision);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, status: "failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, status: "applied" });
}
