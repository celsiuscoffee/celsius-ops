import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { runReviewPenaltyEomReminder } from "@/lib/hr/review-penalty-eom";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-review-penalty-eom — end-of-month "decide before salary"
 * reminder for review penalties.
 *
 * Fires a few days before month-end (see vercel.json). WhatsApps the ops/manager
 * leads a digest of every PENDING hr_review_penalty for the closing month so each
 * gets a deliberate attribute-or-dismiss decision before payroll. Sends nothing
 * when there is nothing pending. Gated by OPS_NUDGES_MODE (shadow → log only).
 *
 * Auth: Bearer CRON_SECRET (Vercel auto-sets).
 */
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  try {
    const result = await runReviewPenaltyEomReminder();
    console.log(`[cron/ops-review-penalty-eom] month=${result.month} pending=${result.pending} sent=${result.managerSent} mode=${result.mode}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "review-penalty EOM reminder failed";
    console.error("[cron/ops-review-penalty-eom]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
