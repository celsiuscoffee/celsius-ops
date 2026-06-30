// Daily cron — the finance loop's auto-clear step. Applies VERIFIED
// high-confidence AP matches (bank outflow ↔ invoice): marks the invoice paid,
// links + tags the bank line so it drops out of P&L opex. Only matches that
// pass the matcher score AND the verifier auto-apply; everything else stays in
// the human review queue at /finance/recon. This is the "no bookkeeper" step.

import { NextRequest, NextResponse } from "next/server";
import { applyApMatches } from "@/lib/finance/ap-match";
import { checkCronAuth } from "@celsius/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  try {
    const result = await applyApMatches({ commit: true, sinceDays: 120 });
    return NextResponse.json({ applied: result.applied, skipped: result.skipped.length });
  } catch (err) {
    console.error("[cron/ap-match-apply]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "apply failed" }, { status: 500 });
  }
}
