import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prepareRound, proposeArms, type ArmDef, type LoopKey } from "@/lib/loyalty/loop-engine";

// POST /api/loyalty/loops/prepare — build a loop round (segment + holdout +
// arms + auto-issue rewards). Returns a preview for approval. NO SMS sent yet.
// loop_key selects the objective (winback/welcome/birthday/round_gap). Arms
// come from the request body (the dashboard sends the approved set); when
// omitted, the optimizer proposes them (champion + challengers) — never a frozen
// template list. segment carries the loop-specific audience controls.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    const loopKey: LoopKey = body.loop_key ?? "winback";
    const arms: ArmDef[] = Array.isArray(body.arms) && body.arms.length
      ? body.arms
      : (await proposeArms(loopKey)).arms.map((a) => ({ key: a.key, label: a.label, voucher_template_id: a.voucher_template_id, message: a.message }));
    const preview = await prepareRound(loopKey, {
      arms,
      holdoutPct: body.holdoutPct,
      attributionWindowDays: body.attributionWindowDays,
      suppressPhones: body.suppressPhones,
      maxRecipients: body.maxRecipients,
      segment: body.segment,
      createdBy: auth.user?.id,
    });
    return NextResponse.json(preview);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to prepare round";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
