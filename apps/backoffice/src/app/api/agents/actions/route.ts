import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAgentClient } from "@/lib/agents/substrate";

export const dynamic = "force-dynamic";

// GET /api/agents/actions?key=<agent_key>&limit=20 — recent ledger entries
// for one agent (the expanded row on /agents).
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 20, 100);

  const { data, error } = await getAgentClient()
    .from("agent_actions")
    .select("id, at, kind, summary, ref_table, ref_id, outlet_id, confidence, autonomous, human_override, model, cost_usd")
    .eq("agent_key", key)
    .order("at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ actions: data ?? [] });
}
