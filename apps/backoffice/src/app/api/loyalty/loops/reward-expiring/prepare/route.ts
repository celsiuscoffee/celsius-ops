import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prepareRound, LOOPS } from "@/lib/loyalty/loop-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/loyalty/loops/reward-expiring/prepare
//   { maxRecipients?: number=60, holdoutPct?: number=20, expiringWithinDays?: number=7 }
//
// Stages a REMINDER round: members holding an unused wallet voucher about to
// expire, split into a holdout + a treatment that gets one SMS naming their own
// reward. NOTHING is minted — the loop attributes the EXISTING voucher (noIssue),
// so we measure whether the nudge lifts redemption/orders vs the holdout.
//
// Does NOT send. Operator reviews the preview, then fires
// POST /api/loyalty/loops/send { round_id }. First send is operator-gated.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    const maxRecipients = Number.isFinite(body?.maxRecipients) ? Number(body.maxRecipients) : 60;
    const holdoutPct = Number.isFinite(body?.holdoutPct) ? Number(body.holdoutPct) : undefined;
    const expiringWithinDays = Number.isFinite(body?.expiringWithinDays) ? Number(body.expiringWithinDays) : undefined;

    const preview = await prepareRound("reward_expiring", {
      // Single message-only arm — the template's {reward}/{expiry} tokens are
      // filled per-recipient in sendRound. voucher_template_id is unused (noIssue).
      arms: [{
        key: "reminder",
        label: "Expiry reminder",
        voucher_template_id: "",
        message: LOOPS.reward_expiring.messageTemplate,
      }],
      holdoutPct,
      maxRecipients,
      segment: { expiringWithinDays },
      createdBy: auth.user?.id,
    });

    if (!preview.round_id) {
      return NextResponse.json({ prepared: false, message: "No members with a voucher expiring in that window — nothing prepared." });
    }
    return NextResponse.json({
      prepared: true,
      ...preview,
      message: `Prepared reward-expiring round: ${preview.arm_counts?.reminder ?? 0} to remind + ${preview.holdout} holdout. Est SMS RM${preview.est_sms_cost_rm}. Review, then POST /api/loyalty/loops/send { round_id } to fire.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to prepare reward-expiring round";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
