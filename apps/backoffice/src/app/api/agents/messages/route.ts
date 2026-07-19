import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAgentClient } from "@/lib/agents/substrate";
import { agentLabel } from "@/lib/agents/messages";

export const dynamic = "force-dynamic";

// GET /api/agents/messages?kind=&limit= - the human-readable agent
// communications feed for the /agents Conversations view. Adds friendly
// from/to labels so the client renders plain English.
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const kind = req.nextUrl.searchParams.get("kind"); // handoff | learning | logic_change | report
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 40, 200);

  let q = getAgentClient()
    .from("agent_messages")
    .select("id, at, from_agent, to_agent, kind, summary, detail, outlet_id")
    .order("at", { ascending: false })
    .limit(limit);
  if (kind) q = q.eq("kind", kind);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    messages: (data ?? []).map((m) => ({
      ...m,
      fromLabel: agentLabel(m.from_agent),
      toLabel: m.to_agent ? agentLabel(m.to_agent) : null,
    })),
  });
}
