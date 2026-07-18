import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { runOpsPulse } from "@/lib/ops-pulse";
import { expireStaleAlerts } from "@/lib/ops-pulse/ledger";

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
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  try {
    // Ledger hygiene runs regardless of pulse mode — expiry closes alerts whose
    // day/window has passed; it pages no one (shadow's "never message" holds).
    const expired = await expireStaleAlerts();
    if (expired > 0) console.log(`[cron/ops-pulse] expired ${expired} stale alerts`);

    const result = await runOpsPulse();
    if (result.breachCount > 0) {
      console.log(`[cron/ops-pulse] mode=${result.mode} breaches=${result.breachCount} sent=${result.sent}`);
    }
    return NextResponse.json({ ok: true, expired, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ops-pulse failed";
    console.error("[cron/ops-pulse]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
