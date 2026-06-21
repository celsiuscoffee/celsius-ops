import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prepareWinbackRound, type ArmDef } from "@/lib/loyalty/loop-engine";

// Default Win Back arms: Free Tea (cheap foot-in-door) vs B1F1 (purchase-required).
const DEFAULT_ARMS: ArmDef[] = [
  {
    key: "free_tea",
    label: "Free Tea",
    voucher_template_id: "1b9a465a-8411-4299-a2e2-8034f2b0ea45",
    message: "We miss you at Celsius! Your FREE TEA is waiting — claim within 30 days. See you soon!",
  },
  {
    key: "b1f1",
    label: "Buy 1 Free 1",
    voucher_template_id: "ed33eb26-4ead-414d-b1ee-179999a33940",
    message: "We miss you at Celsius! Buy 1 Free 1 on any drink — bring a friend! Claim within 30 days.",
  },
];

// POST /api/loyalty/loops/prepare — build a Win Back round (segment + holdout +
// arms + auto-issue rewards). Returns a preview for approval. NO SMS sent yet.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    const arms: ArmDef[] = Array.isArray(body.arms) && body.arms.length ? body.arms : DEFAULT_ARMS;
    const preview = await prepareWinbackRound({
      arms,
      holdoutPct: body.holdoutPct,
      minDaysLapsed: body.minDaysLapsed,
      maxDaysLapsed: body.maxDaysLapsed,
      attributionWindowDays: body.attributionWindowDays,
      suppressPhones: body.suppressPhones,
      createdBy: auth.user?.id,
    });
    return NextResponse.json(preview);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to prepare round";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
