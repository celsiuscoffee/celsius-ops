import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prepareWinbackRound, proposeArms, type ArmDef } from "@/lib/loyalty/loop-engine";

// POST /api/loyalty/loops/prepare — build a Win Back round (segment + holdout +
// arms + auto-issue rewards). Returns a preview for approval. NO SMS sent yet.
// Arms come from the request body (the dashboard sends the approved set); when
// omitted, the optimizer proposes them (champion + challengers) — never a frozen
// template list.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    const arms: ArmDef[] = Array.isArray(body.arms) && body.arms.length
      ? body.arms
      : (await proposeArms()).arms.map((a) => ({ key: a.key, label: a.label, voucher_template_id: a.voucher_template_id, message: a.message }));
    const preview = await prepareWinbackRound({
      arms,
      holdoutPct: body.holdoutPct,
      minDaysLapsed: body.minDaysLapsed,
      maxDaysLapsed: body.maxDaysLapsed,
      attributionWindowDays: body.attributionWindowDays,
      suppressPhones: body.suppressPhones,
      maxRecipients: body.maxRecipients,
      createdBy: auth.user?.id,
    });
    return NextResponse.json(preview);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to prepare round";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
