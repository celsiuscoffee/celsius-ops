import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { applyBudgetChange, rejectBudgetChange } from "@/lib/ads/set-budget";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ads/optimizer/apply-budget — THE approval gate for cutting a Smart
// campaign's daily budget. Only an admin's explicit click reaches this endpoint;
// action "apply" writes the new amount to the Google Ads CampaignBudget, action
// "reject" just records the dismissal.
// Body: { campaignId, newDailyMyr, action: "apply" | "reject",
//         monthlySavingMyr?, projConvLostPerMonth?, reason? }
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireRole(request.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const campaignId: string = body.campaignId;
  const newDailyMyr = Number(body.newDailyMyr);
  const action: string = body.action;
  if (!campaignId || !Number.isFinite(newDailyMyr) || newDailyMyr <= 0 || !["apply", "reject"].includes(action)) {
    return NextResponse.json(
      { error: "campaignId, newDailyMyr (> 0) and action (apply|reject) required" },
      { status: 400 },
    );
  }

  const decision = {
    campaignId,
    newDailyMyr,
    decidedBy: user.name || user.id,
    monthlySavingMyr: typeof body.monthlySavingMyr === "number" ? body.monthlySavingMyr : null,
    projConvLostPerMonth: typeof body.projConvLostPerMonth === "number" ? body.projConvLostPerMonth : null,
    reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
  };

  if (action === "reject") {
    await rejectBudgetChange(decision);
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  const result = await applyBudgetChange(decision);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, status: "failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, status: "applied" });
}
