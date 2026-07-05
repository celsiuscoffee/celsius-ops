// GET /api/finance/reports/channel-settlement?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Read-only channel settlement reconciliation: per company and consolidated,
// sales accrued vs cash settled vs the residual for each channel debtor, with
// the commission (expected permanent) portion split out and the entity net
// surfaced. Covers every active company (with a consolidated total), so it is
// not scoped to the active company switcher.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listCompanies } from "@/lib/finance/companies";
import { buildChannelSettlement } from "@/lib/finance/reports/channel-settlement";

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
    const companies = (await listCompanies())
      .filter((c) => c.isActive)
      .map((c) => ({ id: c.id, name: c.name }));
    const report = await buildChannelSettlement({ start, end, companies });
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
