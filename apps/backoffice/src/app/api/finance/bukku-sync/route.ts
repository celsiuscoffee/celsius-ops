// GET  /api/finance/bukku-sync   → read-only probe (auth + counts + mapped sample), no ingest
// POST /api/finance/bukku-sync   → pull Money In/Out and land in fin_bank_transactions
//   body: { from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" (default: last 7 days to yesterday MYT) }

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { syncBukkuBankFeed, probeBukkuBankFeed } from "@/lib/finance/ingestors/bukku-bank";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function mytDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Read-only connectivity + mapping check. Hit this after entering a token.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const to = sp.get("to") ?? mytDate(-1);
  const from = sp.get("from") ?? mytDate(-14);
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) {
    return NextResponse.json({ error: "Invalid date format. Expected YYYY-MM-DD." }, { status: 400 });
  }
  const probes = await probeBukkuBankFeed({ from, to });
  return NextResponse.json({ from, to, probes });
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
