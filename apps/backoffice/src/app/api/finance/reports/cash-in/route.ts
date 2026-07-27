// GET /api/finance/reports/cash-in?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Revenue-vs-cash-in reconciliation, one row per (entity, channel): revenue
// rung up vs the cash that actually landed in the bank, with the gap judged
// against the channel's expected fee/commission. Card/QR/online/consignment
// are per entity; Grab is group-level (it pools into HQ's account). Read-only,
// covers all entities regardless of the active-company switcher.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { cashInReconByChannel } from "@/lib/finance/cash-in-recon";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const start = params.get("start");
  const end = params.get("end");
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!start || !end || !re.test(start) || !re.test(end)) {
    return NextResponse.json({ error: "start and end (YYYY-MM-DD) required" }, { status: 400 });
  }

  try {
    const report = await cashInReconByChannel(start, end);
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
