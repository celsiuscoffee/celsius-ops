import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getSession } from "@/lib/auth";
import { GET as runRequestInvoices } from "../request-invoices/route";
import { GET as runRequestReceivings } from "../request-receivings/route";
import { GET as runProcurementExecRoute } from "../procurement-exec/route";
import { GET as runConsumptionPost } from "../consumption-post/route";
import { GET as runParLevelsRecalc } from "../par-levels-recalc/route";
import { repromptStaleColdPos } from "@/lib/inventory/procurement-po-send";
import { runLoopWatchdog } from "@/lib/inventory/loop-watchdog";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/procurement-loop — the ONE cron entry for the whole
// procurement/inventory loop. Exists because Vercel caps a project at 40 cron
// jobs and this repo blew past it (46 entries on 2026-07-10): every cron after
// position 40 was silently never scheduled — procurement-exec, par recalc,
// invoice/receiving chases and consumption were all dead for ~10 days and
// nothing noticed. One dispatcher = one slot, and the watchdog below is the
// "nothing notices" fix. (vercel-crons.test.ts fails CI if the file ever
// exceeds the cap again.)
//
// Schedule: 0 1,7,13,19 * * * (UTC) → 09:00 / 15:00 / 21:00 / 03:00 MYT.
// Dispatch by run hour, preserving each job's old cadence:
//   every run       — cold-prompt re-prompts, loop watchdog
//   01,07,13 UTC    — invoice chases + receiving chases (was */4h and */6h)
//   01 UTC          — procurement-exec daily pass (was 0 1 * * *)
//   19 UTC          — consumption post (was 25 19 * * *)
//   19 UTC Sunday   — weekly par-levels recalc (was 7 19 * * 0)
//
// Each job stays its own route (imported GET handlers, same cron-secret auth
// headers passed through) so an OWNER can still trigger any one of them
// manually; this route just owns the schedule. Every job is try/caught — one
// failing job never takes down the rest, and failures surface as watchdog
// alert lines instead of buried console output.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) {
    const user = await getSession();
    if (!user || !["OWNER", "ADMIN"].includes(user.role)) {
      return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
    }
  }

  const hour = new Date().getUTCHours();
  const isSunday = new Date().getUTCDay() === 0;
  const out: Record<string, unknown> = { hourUtc: hour };
  const failures: string[] = [];

  const step = async (name: string, when: boolean, fn: () => Promise<Response>) => {
    if (!when) return;
    try {
      const res = await fn();
      out[name] = await res.json().catch(() => ({ status: res.status }));
      if (res.status >= 500) failures.push(`${name} returned ${res.status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      out[name] = { error: msg };
      failures.push(`${name} threw: ${msg.slice(0, 80)}`);
      console.error(`[procurement-loop:${name}]`, err);
    }
  };

  // Chases on the three "working hours" runs; heavy inventory math on the
  // quiet 03:00-MYT run.
  await step("exec", hour === 1, () => runProcurementExecRoute(req));
  await step("invoiceChases", hour !== 19, () => runRequestInvoices(req));
  await step("receivingChases", hour !== 19, () => runRequestReceivings(req));
  await step("consumption", hour === 19, () => runConsumptionPost(req));
  await step("parRecalc", hour === 19 && isSunday, () => runParLevelsRecalc(req));

  // Cold-prompt re-prompts: a prompted-but-unanswered PO gets one nudge after
  // 24h; after that it's flagged for the manual lane instead of dead-airing.
  try {
    out.reprompts = await repromptStaleColdPos();
  } catch (err) {
    failures.push("reprompts threw");
    console.error("[procurement-loop:reprompts]", err);
  }

  // Watchdog LAST so it sees this run's failures too.
  try {
    out.watchdog = await runLoopWatchdog({ runFailures: failures });
  } catch (err) {
    console.error("[procurement-loop:watchdog]", err);
    out.watchdog = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({ ok: true, ...out });
}
