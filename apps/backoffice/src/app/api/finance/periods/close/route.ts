// POST /api/finance/periods/close
// Body: { period: "YYYY-MM", lock?: boolean }
//
// Runs depreciation + snapshot. If lock=true, flips the period to closed.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runClose } from "@/lib/finance/agents/close";
import { getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { period?: string; lock?: boolean; companyId?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  if (!body.period || !/^\d{4}-\d{2}$/.test(body.period)) {
    return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  }
  const companyId = body.companyId ?? (await getActiveCompanyId());

  try {
    const result = await runClose({
      companyId,
      period: body.period,
      lock: !!body.lock,
      actor: auth.user.id,
    });
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
