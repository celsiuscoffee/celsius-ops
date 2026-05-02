// GET /api/finance/exceptions
// Lists open exceptions (default) or filtered by status / agent / type.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";
import { getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "open";
  const agent = url.searchParams.get("agent");
  const type = url.searchParams.get("type");
  const companyId = url.searchParams.get("companyId") ?? (await getActiveCompanyId());
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 500);

  const client = getFinanceClient();
  let q = client
    .from("fin_exceptions")
    .select(
      "id, company_id, type, related_type, related_id, agent, reason, proposed_action, priority, status, created_at, resolved_at"
    )
    .eq("company_id", companyId)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (agent) q = q.eq("agent", agent);
  if (type) q = q.eq("type", type);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sort by priority client-side after the date sort so urgent items rise
  // to the top while still being chronological within priority.
  const sorted = (data ?? []).slice().sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority as string] ?? 99;
    const pb = PRIORITY_ORDER[b.priority as string] ?? 99;
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime();
  });

  return NextResponse.json({ exceptions: sorted });
}
