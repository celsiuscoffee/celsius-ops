import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildKeywordStrategy } from "@/lib/geogrid/keyword-selection";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/geogrid/keyword-strategy — per outlet, each tracked keyword bucketed
// (own / focus / prominence / retire) from its measured rank + demand, with the
// next action. Read-only; retiring a keyword goes through the POST below.
export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const report = await buildKeywordStrategy();
  return NextResponse.json(report);
}

// POST /api/geogrid/keyword-strategy — approval-gated (ADMIN) toggle of a
// keyword's tracking. "retire" stops the geogrid scanning it (saves scan
// budget); "reactivate" puts it back. Reversible, so no ledger — the active
// flag on GeoGridKeyword is the source of truth.
// Body: { outletId, keyword, action: "retire" | "reactivate" }
export async function POST(request: NextRequest) {
  try {
    await requireRole(request.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const outletId: string = body.outletId;
  const keyword: string = (body.keyword || "").trim();
  const action: string = body.action;
  if (!outletId || !keyword || !["retire", "reactivate"].includes(action)) {
    return NextResponse.json({ error: "outletId, keyword and action (retire|reactivate) required" }, { status: 400 });
  }

  const res = await prisma.geoGridKeyword.updateMany({
    where: { outletId, keyword },
    data: { active: action === "reactivate" },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "Keyword not tracked for this outlet" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, active: action === "reactivate" });
}
