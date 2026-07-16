import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { generateChecklistsForOutlet } from "@/lib/checklists/generate";

/**
 * POST /api/checklists/generate
 * Generate today's checklists for an outlet on demand (tab-open backstop).
 *
 * The primary generation path is the daily cron
 * (/api/cron/generate-checklists at 00:15 MYT) — this endpoint remains so a
 * mid-day SOP publish or a new outlet still gets its tasks without waiting a
 * day. Generation lives in @/lib/checklists/generate and is idempotent.
 *
 * Body: { outletId, date? }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const outletId = body.outletId as string;
  if (!outletId) {
    return NextResponse.json({ error: "outletId is required" }, { status: 400 });
  }

  const created = await generateChecklistsForOutlet(outletId, body.date || undefined);
  return NextResponse.json({ message: `Generated ${created} checklist(s)`, created });
}
