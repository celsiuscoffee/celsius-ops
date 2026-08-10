import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkCronAuth } from "@celsius/shared";
import { generateChecklistsForOutlet } from "@/lib/checklists/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/generate-checklists — daily at 00:15 MYT (16:15 UTC).
 *
 * Creates the day's checklists for EVERY active outlet, so tasks exist from
 * the start of the day. Before this cron, generation only ran when someone
 * opened the Checklists tab: outlets where nobody opened it got no checklists
 * at all (Nilai had zero for 2026-07-06..09), and most days the first open
 * was ~15:00 MYT — morning tasks were born hours past due, outside the
 * overdue-nudge window, so they were never chased and rotted as PENDING.
 *
 * Runs after reset-checklists (00:00 MYT) and before the backoffice
 * checklist-assign cron (every 30 min from 08:00 MYT), which gives each task
 * a fair owner from the published roster. Idempotent — safe to re-run.
 */
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE", type: "OUTLET" },
    select: { id: true, name: true },
  });

  let created = 0;
  const failures: string[] = [];
  for (const o of outlets) {
    try {
      created += await generateChecklistsForOutlet(o.id);
    } catch (err) {
      // One outlet failing must not starve the rest of the fleet.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/generate-checklists] ${o.name} failed:`, msg);
      failures.push(o.name);
    }
  }

  console.log(
    `[cron/generate-checklists] outlets=${outlets.length} created=${created} failures=${failures.length}`,
  );
  return NextResponse.json({ ok: true, outlets: outlets.length, created, failures });
}
