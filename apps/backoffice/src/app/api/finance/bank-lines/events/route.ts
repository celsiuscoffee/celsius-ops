// GET /api/finance/bank-lines/events?lineId=... - the audit trail for one
// bank line, newest first. Written best-effort by the classify / match /
// unmatch / reject-match routes (fin_bank_line_events, migration 071).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const lineId = new URL(req.url).searchParams.get("lineId");
  if (!lineId) return NextResponse.json({ error: "lineId required" }, { status: 400 });

  const client = getFinanceClient();
  const { data, error } = await client
    .from("fin_bank_line_events")
    .select("id, event, old_value, new_value, actor, created_at")
    .eq("line_id", lineId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    // 42P01 = table missing (migration 071 not applied yet): empty history,
    // not an error, so the UI stays usable.
    if (error.code === "42P01") return NextResponse.json({ events: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ events: data ?? [] });
}
