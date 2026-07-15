// EOM bank reconciliation runner. The routine finance loop (bukku-feed-sync,
// every 6h) is RECONCILE-ONLY — the Telegram proof-of-payment flow is the
// primary payer. This endpoint is the month-end catch-all that IS allowed to
// mark open invoices PAID from the bank statement (markOpenPaid:true) — it
// settles whatever the POP flow didn't, then links + tags the bank line so it
// drops out of P&L opex. Not on the 6-hourly schedule; trigger at EOM.

import { NextRequest, NextResponse } from "next/server";
import { applyApMatches } from "@/lib/finance/ap-match";
import { applyVerifiedReview } from "@/lib/finance/agents/ap-verifier";
import { createWagePaymentSlips } from "@/lib/finance/payment-slips";
import { checkCronAuth } from "@celsius/shared";
import { getAgentModeOrDefault, touchAgentRun } from "@/lib/agents/substrate";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  // Registry kill switch (/agents). Fail-open to armed: a missing registry
  // row or DB blip must never silently stop the ledger loop — only an
  // explicit mode=off does.
  await touchAgentRun("finance_ap_match_apply");
  const mode = await getAgentModeOrDefault("finance_ap_match_apply", "armed");
  if (mode === "off") {
    return NextResponse.json({ skipped: true, reason: "agent_registry mode=off" });
  }
  try {
    // 1) rules tier — amount-exact + name-confirmed → settle open invoices too.
    const auto = await applyApMatches({ commit: true, sinceDays: 120, markOpenPaid: true });
    // 2) review tier — LLM verifier judges the gray zone; confident confirms
    //    auto-clear, rejects drop, only true uncertainties stay for a human.
    const review = await applyVerifiedReview({ commit: true, sinceDays: 120, markOpenPaid: true });
    // 3) wages have no invoice — document them with auto payment slips so they
    //    leave the unmatched pile with a supporting doc instead of a match.
    const slips = await createWagePaymentSlips({ commit: true });
    return NextResponse.json({
      autoApplied: auto.applied,
      reviewConfirmedApplied: review.confirmedApplied,
      reviewRejected: review.rejected,
      reviewUncertain: review.uncertain,
      paymentSlipsCreated: slips.created,
    });
  } catch (err) {
    console.error("[cron/ap-match-apply]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "apply failed" }, { status: 500 });
  }
}
