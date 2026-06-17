// Manual trigger for the Bukku bank-feed sync. Pulls Money In / Money Out from
// every Bukku-enabled outlet for a date range and lands them in
// fin_bank_transactions (idempotent). Read-only against Bukku.
//
// POST /api/finance/bukku-sync
//   body: { from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" (default: last 7 days to yesterday MYT) }

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { syncBukkuBankFeed } from "@/lib/finance/ingestors/bukku-bank";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function mytDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
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

  const to = body.to ?? mytDate(-1);
  const from = body.from ?? mytDate(-8);
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) {
    return NextResponse.json({ error: "Invalid date format. Expected YYYY-MM-DD." }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: "`from` must be on or before `to`." }, { status: 400 });
  }

  const result = await syncBukkuBankFeed({ from, to });
  return NextResponse.json(result);
}
