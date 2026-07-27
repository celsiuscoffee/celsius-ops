import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { touchAgentRun } from "@celsius/agents/src/substrate";
import { ensurePulseWebhook } from "@celsius/agents/src/pulse";
import { GET as runClockin } from "../ops-nudge-clockin/route";
import { GET as runReview } from "../ops-nudge-review/route";
import { GET as runChecklist } from "../ops-nudge-checklist/route";
import { GET as runStore } from "../ops-nudge-store/route";
import { GET as runAudit } from "../ops-nudge-audit/route";
import { GET as runStockcount } from "../ops-nudge-stockcount/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/ops-nudges — ONE cron entry for the whole ops-nudge family.
// Exists for the same reason as /api/cron/procurement-loop: Vercel caps a
// project at 40 cron jobs, this repo hit 46, and every entry past 40 was
// silently never scheduled. Folding the six nudges into one dispatcher frees
// five slots without touching any nudge's logic or cadence — each nudge stays
// its own route (imported handlers, same auth headers) and its own ledger
// dedupe, so cadence-vs-dedupe behaviour is unchanged.
//
// Schedule: */5 * * * * (the tightest cadence in the family). Dispatch:
//   every tick            — clock-in, review           (were */5)
//   :00/:15/:30/:45 ticks — checklist, store status    (were */15)
//   01:00–01:04 UTC tick  — audit                      (was 0 1 * * *)
//   10:00–10:04 UTC tick  — stock count                (was 0 10 * * *)
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const d = new Date();
  const minute = d.getUTCMinutes();
  const hour = d.getUTCHours();
  const out: Record<string, unknown> = {};

  const step = async (name: string, when: boolean, fn: () => Promise<Response>) => {
    if (!when) return;
    try {
      const res = await fn();
      out[name] = await res.json().catch(() => ({ status: res.status }));
    } catch (err) {
      out[name] = { error: err instanceof Error ? err.message : String(err) };
      console.error(`[ops-nudges:${name}]`, err);
    }
  };

  await step("clockin", true, () => runClockin(req));
  await step("review", true, () => runReview(req));
  await step("checklist", minute % 15 < 5, () => runChecklist(req));
  await step("store", minute % 15 < 5, () => runStore(req));
  await step("audit", hour === 1 && minute < 5, () => runAudit(req));
  await step("stockcount", hour === 10 && minute < 5, () => runStockcount(req));

  // Heartbeat only. This dispatcher runs every 5 min, so posting a feed line
  // per tick would be noise; the touch keeps /agents from showing the ops
  // family as "never ran". Each sub-nudge still records its own sends.
  await touchAgentRun("ops_nudges");

  // Self-heal the two-way pulse webhook. This is the highest-frequency cron, so
  // registration lands within ~5 min of a deploy without anyone clicking the
  // /agents Connect button. Idempotent + guarded (at most one Telegram call per
  // warm instance); returns a diagnostic so the result is visible in the cron
  // response and Vercel logs.
  out.webhook = await ensurePulseWebhook();

  return NextResponse.json({ ok: true, ...out });
}
