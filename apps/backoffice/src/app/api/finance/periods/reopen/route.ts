// POST /api/finance/periods/reopen
// Body: { period: "YYYY-MM", reason: string }

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { reopenPeriod } from "@/lib/finance/agents/close";
import { getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (auth.user.role !== "OWNER") {
    return NextResponse.json({ error: "Owners only" }, { status: 403 });
  }

  let body: { period?: string; reason?: string; companyId?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  if (!body.period || !/^\d{4}-\d{2}$/.test(body.period)) {
    return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  }
  if (!body.reason || body.reason.length < 5) {
    return NextResponse.json({ error: "reason required (min 5 chars)" }, { status: 400 });
  }
  const companyId = body.companyId ?? (await getActiveCompanyId());

  try {
    await reopenPeriod(companyId, body.period, auth.user.id, body.reason);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
