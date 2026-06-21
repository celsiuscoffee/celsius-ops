import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prepareWinbackRound, type ArmDef } from "@/lib/loyalty/loop-engine";

// Default Win Back arms — sales-driving offer logics compared head to head
// (every arm needs a real basket; no claim-and-leave freebies):
//   % discount · flat discount · BOGO. Override via the request body / the
//   backoffice "Win-back Loops" page.
const DEFAULT_ARMS: ArmDef[] = [
  {
    key: "pct15",
    label: "15% off RM40+",
    voucher_template_id: "eb47fd73-42ab-4eb6-ade4-a12f96912d00",
    message: "We miss you at Celsius! Enjoy 15% off when you spend RM40+. Tap to use — valid 14 days.",
  },
  {
    key: "flat10",
    label: "RM10 off RM30+",
    voucher_template_id: "02ca62f1-171d-41d2-b6d6-9ca2d67ca3b9",
    message: "We miss you at Celsius! Here's RM10 off your next RM30+ order. Tap to use — valid 14 days.",
  },
  {
    key: "b1f1",
    label: "Buy 1 Free 1 drinks",
    voucher_template_id: "ed33eb26-4ead-414d-b1ee-179999a33940",
    message: "We miss you at Celsius! Buy 1 Free 1 on any drink — bring a friend! Valid 30 days.",
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
