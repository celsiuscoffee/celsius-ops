// Manual trigger for the Anomaly sweep. Scans bills + posted transactions for a
// date range and raises exceptions (duplicate bills, out-of-balance, missing
// docs, amount outliers). Raise-only — never posts. Idempotent (one open
// exception per related row + type).
//
// POST /api/finance/anomaly
//   body: { from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" (default: both = yesterday MYT) }

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runAnomalySweep } from "@/lib/finance/agents/anomaly";

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

  let body: { from?: string; to?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }

  const from = body.from ?? yesterdayMyt();
  const to = body.to ?? from;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) {
    return NextResponse.json({ error: "Invalid date format. Expected YYYY-MM-DD." }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: "`from` must be on or before `to`." }, { status: 400 });
  }

  const summary = await runAnomalySweep({ from, to });
  return NextResponse.json({ summary });
}
