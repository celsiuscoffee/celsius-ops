import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { runReviewNudges } from "@/lib/ops-nudges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-nudge-review — bad-review nudge.
 *
 * New negative reviews (internal QR <=2*, Google <=3*, last 72h) DM'd to the
 * outlet's on-shift team for service recovery + a digest to the managers (ops
 * leads). Hourly; the ledger dedupes per review so each is nudged once.
 * OPS_NUDGES_MODE (off|shadow|armed, default armed).
 * Design: docs/design/ops-performance-loop.md.
 */
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  try {
    const result = await runReviewNudges();
    console.log(`[cron/ops-nudge-review] mode=${result.mode} items=${result.items} staff=${result.staffSent} mgr=${result.managerSent}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ops-nudge-review failed";
    console.error("[cron/ops-nudge-review]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
