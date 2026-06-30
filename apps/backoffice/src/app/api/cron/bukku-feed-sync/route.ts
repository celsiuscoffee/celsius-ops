// Finance-loop cron — runs the whole pipeline every 6h on ONE schedule, because
// Vercel caps the project's cron jobs and the standalone gl-post / ap-match-apply
// crons silently never registered (43 > the 40-cron limit). Chaining them here,
// onto the bukku-feed-sync cron that DOES fire, guarantees the loop runs:
//
//   1. INGEST   — pull Bukku's raw Maybank feed → classified BankStatementLine
//   2. MATCH    — AP-match supplier outflows ↔ procurement invoices (auto + LLM)
//   3. SLIPS    — auto payment slips for wage lines (no invoice)
//   4. POST     — post classified bank lines into the double-entry GL
//
// Every step is independent (try/caught) so one failure never blocks the rest.
// Each is idempotent + bounded, so re-running every 6h is safe and drains the
// backlog over a few runs.

import { NextRequest, NextResponse } from "next/server";
import { syncBukkuFeedLedger } from "@/lib/finance/bukku-feed-sync";
import { applyApMatches } from "@/lib/finance/ap-match";
import { applyVerifiedReview } from "@/lib/finance/agents/ap-verifier";
import { createWagePaymentSlips } from "@/lib/finance/payment-slips";
import { postBankLinesToGl } from "@/lib/finance/gl-posting";
import { checkCronAuth } from "@celsius/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GL_LINES_PER_RUN = 3000; // bounded so the whole loop stays inside maxDuration

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { out[name] = await fn(); }
    catch (err) { out[name] = { error: err instanceof Error ? err.message : String(err) }; console.error(`[finance-loop:${name}]`, err); }
  };

  // 1. ingest the bank feed (must run first — the rest acts on its output)
  await step("feed", async () => {
    const { accounts } = await syncBukkuFeedLedger({ commit: true });
    return { accounts: accounts.length, newLines: accounts.reduce((s, a) => s + a.newLines, 0) };
  });
  // 2. match supplier outflows → invoices (rules tier, then LLM verifier tier)
  await step("apMatchAuto", async () => ({ applied: (await applyApMatches({ commit: true, sinceDays: 120 })).applied }));
  await step("apMatchReview", async () => {
    const r = await applyVerifiedReview({ commit: true, sinceDays: 120 });
    return { confirmed: r.confirmedApplied, rejected: r.rejected, uncertain: r.uncertain };
  });
  // 3. payment slips for wage lines (no invoice to match)
  await step("paymentSlips", async () => ({ created: (await createWagePaymentSlips({ commit: true })).created }));
  // 4. post the classified bank lines into the GL (bounded; drains over runs)
  await step("glPost", async () => {
    const r = await postBankLinesToGl({ commit: true, limit: GL_LINES_PER_RUN });
    return { journals: r.journals, postedLines: r.postedLines, suspenseLines: r.suspenseLines, errors: r.errors.length };
  });

  return NextResponse.json(out);
}
