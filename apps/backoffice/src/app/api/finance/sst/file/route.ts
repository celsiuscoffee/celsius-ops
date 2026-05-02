// POST /api/finance/sst/file
// Body: { period: "YYYY-MM:MM", paymentRef: string }
// Marks an SST-02 filing as filed once the human has submitted to JKDM and
// settled payment. Logs the payment reference for audit.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { markFiled } from "@/lib/finance/agents/sst";
import { getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { period?: string; paymentRef?: string; companyId?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  if (!body.period || !body.paymentRef) {
    return NextResponse.json({ error: "period and paymentRef required" }, { status: 400 });
  }
  const companyId = body.companyId ?? (await getActiveCompanyId());

  try {
    await markFiled(companyId, body.period, body.paymentRef, auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
