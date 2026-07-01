// GET /api/finance/reports/aged-payables?asOf=YYYY-MM-DD

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildAgedPayables } from "@/lib/finance/reports/aging";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const asOf = new URL(req.url).searchParams.get("asOf");
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return NextResponse.json({ error: "asOf (YYYY-MM-DD) required" }, { status: 400 });
  try {
    return NextResponse.json({ report: await buildAgedPayables({ asOf }) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
