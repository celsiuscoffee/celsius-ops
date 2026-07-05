import { NextResponse } from "next/server";
import { cronRoute } from "@/lib/cron-monitor";
import { runAuditNudges } from "@/lib/ops-nudges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-nudge-audit — weekly audit nudge to the discipline leads.
 *
 * Outlet audits + staff skill training overdue this week, routed by discipline:
 * barista -> Syafiq, kitchen -> Chef Bo. DAILY progress snapshot — each day the
 * lead gets their CURRENT outstanding audits, so the list shrinks + skill counts
 * climb as they work through them. OPS_NUDGES_MODE (off|shadow|armed, default armed).
 * Design: docs/design/ops-performance-loop.md.
 */
async function runOpsNudgeAudit() {
  try {
    const result = await runAuditNudges();
    console.log(`[cron/ops-nudge-audit] mode=${result.mode} items=${result.items} leads=${result.staffSent}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ops-nudge-audit failed";
    console.error("[cron/ops-nudge-audit]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = cronRoute("ops-nudge-audit", runOpsNudgeAudit);
