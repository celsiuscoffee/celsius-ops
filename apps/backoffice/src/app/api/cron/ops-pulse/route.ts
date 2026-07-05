import { NextResponse } from "next/server";
import { runOpsPulse } from "@/lib/ops-pulse";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-pulse — the Ops KPI Pulse sweep.
 *
 * Phase 1 (SHADOW): detects KPI breaches (POS phone-capture rate, overdue
 * checklists), resolves the accountable manager, and LOGS what it would page.
 * It sends nothing and writes nothing — a read-only week to confirm the
 * detectors fire on real breaches before we arm escalation. Controlled by
 * OPS_PULSE_MODE (off | shadow | armed); unset ⇒ shadow.
 *
 * Scheduled hourly while shadowing (vercel.json). Once armed and backed by the
 * OpsAlert ledger (which dedupes), this tightens to a 15-minute cadence for
 * real-time paging.
 *
 * Design: docs/design/ops-kpi-pulse-loop.md.
 */
async function runOpsPulseCron() {
  try {
    const result = await runOpsPulse();
    if (result.breachCount > 0) {
      console.log(`[cron/ops-pulse] mode=${result.mode} breaches=${result.breachCount} sent=${result.sent}`);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ops-pulse failed";
    console.error("[cron/ops-pulse]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = cronRoute("ops-pulse", runOpsPulseCron);
