import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAgentClient, logAgentAction, type AgentMode } from "@celsius/agents/src/substrate";
import { estimateCostUsd } from "@celsius/agents/src/pricing";
import { logAgentMessage, agentLabel } from "@celsius/agents/src/messages";

export const dynamic = "force-dynamic";

// Expected cost per run + per 30-day month from the token estimates on the
// registry row. Non-LLM agents (no model / no token estimate) cost 0.
function expectedCost(r: {
  model: string | null;
  uses_llm: boolean;
  est_input_tokens: number | null;
  est_output_tokens: number | null;
  est_cache_read_tokens: number | null;
  est_runs_per_day: number | null;
}): { perRun: number; perMonth: number } {
  if (!r.uses_llm || r.est_input_tokens == null) return { perRun: 0, perMonth: 0 };
  const perRun = estimateCostUsd(r.model, {
    inputTokens: r.est_input_tokens ?? 0,
    outputTokens: r.est_output_tokens ?? 0,
    cacheReadTokens: r.est_cache_read_tokens ?? 0,
  });
  return { perRun, perMonth: perRun * (r.est_runs_per_day ?? 0) * 30 };
}

// GET /api/agents/registry — the fleet, with 7-day action counts, expected
// cost, and 30-day actual spend from the ledger.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = getAgentClient();
  const [registryRes, weekRes, monthRes] = await Promise.all([
    client.from("agent_registry").select("*").order("domain").order("name"),
    client
      .from("agent_actions")
      .select("agent_key, autonomous, human_override")
      .gte("at", new Date(Date.now() - 7 * 24 * 3600_000).toISOString()),
    client
      .from("agent_actions")
      .select("agent_key, cost_usd")
      .gte("at", new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
  ]);
  if (registryRes.error) {
    return NextResponse.json({ error: registryRes.error.message }, { status: 500 });
  }

  const counts: Record<string, { total: number; autonomous: number; overridden: number }> = {};
  for (const a of weekRes.data ?? []) {
    const c = (counts[a.agent_key] ??= { total: 0, autonomous: 0, overridden: 0 });
    c.total += 1;
    if (a.autonomous) c.autonomous += 1;
    if (a.human_override) c.overridden += 1;
  }

  const actual30d: Record<string, number> = {};
  for (const a of monthRes.data ?? []) {
    if (a.cost_usd != null) actual30d[a.agent_key] = (actual30d[a.agent_key] ?? 0) + Number(a.cost_usd);
  }

  return NextResponse.json({
    agents: (registryRes.data ?? []).map((r) => ({
      ...r,
      week: counts[r.key] ?? { total: 0, autonomous: 0, overridden: 0 },
      estCost: expectedCost(r),
      actualCost30d: actual30d[r.key] ?? 0,
    })),
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

  // A mode flip changes what the agent is allowed to do, so record it as a
  // logic change on the Conversations feed (and push it - the owner will want
  // to know an agent was just armed or switched off).
  const MODE_WORDS: Record<AgentMode, string> = { off: "switched off", shadow: "set to shadow (watch-only)", armed: "armed (acting on its own)" };
  await logAgentMessage({
    fromAgent: key,
    kind: "logic_change",
    summary: `${agentLabel(key)} was ${MODE_WORDS[mode]} by ${user.name ?? "an admin"} (was ${existing.mode}).`,
  });

  return NextResponse.json({ ok: true, key, mode });
}
