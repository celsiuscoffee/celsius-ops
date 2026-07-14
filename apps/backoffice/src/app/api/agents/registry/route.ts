import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAgentClient, logAgentAction, type AgentMode } from "@/lib/agents/substrate";

export const dynamic = "force-dynamic";

// GET /api/agents/registry — the fleet, with 7-day action counts.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = getAgentClient();
  const [registryRes, actionsRes] = await Promise.all([
    client.from("agent_registry").select("*").order("domain").order("name"),
    client
      .from("agent_actions")
      .select("agent_key, autonomous, human_override")
      .gte("at", new Date(Date.now() - 7 * 24 * 3600_000).toISOString()),
  ]);
  if (registryRes.error) {
    return NextResponse.json({ error: registryRes.error.message }, { status: 500 });
  }

  const counts: Record<string, { total: number; autonomous: number; overridden: number }> = {};
  for (const a of actionsRes.data ?? []) {
    const c = (counts[a.agent_key] ??= { total: 0, autonomous: 0, overridden: 0 });
    c.total += 1;
    if (a.autonomous) c.autonomous += 1;
    if (a.human_override) c.overridden += 1;
  }

  return NextResponse.json({
    agents: (registryRes.data ?? []).map((r) => ({ ...r, week: counts[r.key] ?? { total: 0, autonomous: 0, overridden: 0 } })),
  });
}

const MODES: AgentMode[] = ["off", "shadow", "armed"];

// PATCH /api/agents/registry — flip an agent's mode. Every flip is itself a
// ledger entry, so the audit trail includes who armed what and when.
export async function PATCH(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key : null;
  const mode = MODES.includes(body?.mode) ? (body.mode as AgentMode) : null;
  if (!key || !mode) {
    return NextResponse.json({ error: "key and mode (off|shadow|armed) required" }, { status: 400 });
  }

  const client = getAgentClient();
  const { data: existing, error: readErr } = await client
    .from("agent_registry")
    .select("key, mode, arming_criteria")
    .eq("key", key)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Unknown agent" }, { status: 404 });

  // Arming without pre-committed criteria is the graveyard pattern the
  // substrate exists to prevent — block it at the API, not just the UI.
  if (mode === "armed" && !existing.arming_criteria) {
    return NextResponse.json(
      { error: "Set arming criteria before arming this agent" },
      { status: 422 },
    );
  }

  const { error: updErr } = await client
    .from("agent_registry")
    .update({ mode, updated_at: new Date().toISOString() })
    .eq("key", key);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await logAgentAction({
    agentKey: key,
    kind: "mode_change",
    summary: `${existing.mode} -> ${mode} by ${user.name ?? user.id}`,
    autonomous: false,
    meta: { userId: user.id, from: existing.mode, to: mode },
  });

  return NextResponse.json({ ok: true, key, mode });
}
