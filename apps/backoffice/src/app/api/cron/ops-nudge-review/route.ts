import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { runReviewNudges } from "@/lib/ops-nudges";
import { syncNegativeReviewDrafts } from "@/lib/reviews/sync-negatives";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-nudge-review — bad-review nudge.
 *
 * First INGESTS new negative Google reviews from GBP into ReviewReplyDraft (same
 * path the reviews board uses — so negatives no longer wait for a human to open
 * the board), then DMs the outlet's on-shift team for service recovery + a digest
 * to the managers (ops leads). Covers internal QR <=2* + Google <=3* (last 72h).
 * Runs every 5 min (near-realtime — a bad review reaches the team within minutes);
 * the ledger dedupes per review so each is nudged once. For TRUE instant delivery,
 * GBP Pub/Sub notifications would push new reviews to a webhook (needs GCP setup).
 * OPS_NUDGES_MODE (off|shadow|armed, default armed).
 * Design: docs/design/ops-performance-loop.md.
 */
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  try {
    // 1) Ingest new negative Google reviews into ReviewReplyDraft (same path the
    // board uses) so there's something to nudge — they're no longer dependent on
    // a human opening the reviews board. Best-effort; never blocks the nudge.
    let ingest = { created: 0, resolved: 0 };
    try {
      ingest = await syncNegativeReviewDrafts();
    } catch (e) {
      console.error("[cron/ops-nudge-review] negative-review sync failed:", e);
    }
    // 2) Nudge on-shift teams + managers for the (now-ingested) new negatives.
    const result = await runReviewNudges();
    console.log(
      `[cron/ops-nudge-review] ingested=${ingest.created} resolved=${ingest.resolved} mode=${result.mode} items=${result.items} staff=${result.staffSent} mgr=${result.managerSent}`,
    );
    return NextResponse.json({ ok: true, ingest, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ops-nudge-review failed";
    console.error("[cron/ops-nudge-review]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
