// Cron — the finance loop's POST step. Posts not-yet-posted classified bank
// lines into the double-entry ledger (aggregated per company/outlet/category/
// day). Idempotent via BankStatementLine.glTransactionId, so each run drains the
// backlog and steady-state only touches the day's new lines. Bounded per run to
// stay inside maxDuration; the rest is picked up next run.

import { NextRequest, NextResponse } from "next/server";
import { postBankLinesToGl } from "@/lib/finance/gl-posting";
import { checkCronAuth } from "@celsius/shared";
import { getAgentModeOrDefault, touchAgentRun, logAgentAction } from "@/lib/agents/substrate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PER_RUN_LINE_CAP = 4000; // oldest-first; keeps one run well inside maxDuration

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  // Registry kill switch (/agents). Fail-open to armed — only an explicit
  // mode=off stops posting; a missing row or DB blip never does.
  await touchAgentRun("finance_gl_post");
  const mode = await getAgentModeOrDefault("finance_gl_post", "armed");
  if (mode === "off") {
    return NextResponse.json({ skipped: true, reason: "agent_registry mode=off" });
  }
  try {
    const res = await postBankLinesToGl({ commit: true, limit: PER_RUN_LINE_CAP });
    if (res.journals > 0) {
      await logAgentAction({
        agentKey: "finance_gl_post",
        kind: "journals_posted",
        summary: `Posted ${res.journals} GL journal${res.journals === 1 ? "" : "s"} from ${res.postedLines} bank lines${res.suspenseLines ? ` (${res.suspenseLines} to suspense)` : ""}`,
        meta: { journals: res.journals, postedLines: res.postedLines, suspenseLines: res.suspenseLines, errors: res.errors.length },
      });
    }
    return NextResponse.json({
      committed: res.committed,
      scannedLines: res.scannedLines,
      journalsPosted: res.journals,
      postedLines: res.postedLines,
      suspenseLines: res.suspenseLines,
      skippedLines: res.skippedLines,
      errors: res.errors.length,
      firstErrors: res.errors.slice(0, 3),
    });
  } catch (err) {
    console.error("[cron/gl-post]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "gl-post failed" }, { status: 500 });
  }
}
