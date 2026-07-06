import { NextResponse } from "next/server";
import { runReminderDueNudges } from "@/lib/ops-reminders";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-reminders — the reminder due-nudge sweep.
 *
 * Re-pings the assignee of any OPEN reminder that has come due but hasn't been
 * nudged since it fell due (the on-assign ping happens at create time). Hourly,
 * so a reminder set for "3pm" lands its WhatsApp within the hour. Best-effort:
 * a free-form send outside the recipient's 24h window won't deliver, but the
 * reminder is stamped so the sweep doesn't re-ping it every run.
 *
 * Design: docs/design/ops-kpi-pulse-loop.md (workspace reminders extension).
 */
async function runOpsReminders() {
  try {
    const result = await runReminderDueNudges();
    console.log(`[cron/ops-reminders] considered=${result.considered} sent=${result.sent}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ops-reminders nudge failed";
    console.error("[cron/ops-reminders]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = cronRoute("ops-reminders", runOpsReminders);
