// Manual trigger for StoreHub EOD ingest. Idempotent — re-running for the
// same outlet+date is safe. Used for backfills, testing, and the "Run now"
// button in the finance UI.
//
// POST /api/finance/ingest/storehub-eod
//   body: { date?: "YYYY-MM-DD" (default yesterday MYT), outletId?: string (default all) }

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { ingestOutletEod, ingestAllOutletsEod } from "@/lib/finance/ingestors/storehub-eod";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function yesterdayMyt(): string {
  const now = new Date();
  const myt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  myt.setUTCDate(myt.getUTCDate() - 1);
  return myt.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { date?: string; outletId?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }

  const date = body.date ?? yesterdayMyt();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date format. Expected YYYY-MM-DD." }, { status: 400 });
  }

  if (body.outletId) {
    const result = await ingestOutletEod(body.outletId, date);
    return NextResponse.json({ date, results: [result] });
  }

  const results = await ingestAllOutletsEod(date);
  return NextResponse.json({ date, results });
}
