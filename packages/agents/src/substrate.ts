import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { costFromUsage } from "./pricing";

// Shared substrate for every autonomous actor (see migration 080). New agents
// MUST go through this module instead of inventing their own flag/queue/log:
//   - getAgentMode(key)  -> the DB-backed kill switch (off | shadow | armed)
//   - touchAgentRun(key) -> heartbeat for the /agents panel
//   - logAgentAction(..) -> append-only action ledger (never throws)
// Legacy env-var flags keep working during migration; the registry row's
// kill_switch_note says where they live until the reader moves over.

export type AgentMode = "off" | "shadow" | "armed";

export interface AgentActionInput {
  agentKey: string;
  kind: string; // sms_sent | reply_posted | journal_posted | proposal | escalation | skip | ...
  summary: string;
  refTable?: string;
  refId?: string;
  outletId?: string;
  confidence?: number;
  autonomous?: boolean; // default true; false = human-initiated/approved path
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  // Pass the raw Anthropic response.usage and the substrate fills in
  // inputTokens/outputTokens/costUsd from lib/agents/pricing.ts. Ignored if
  // costUsd is already set explicitly.
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  } | null;
  meta?: Record<string, unknown>;
}

let cachedClient: SupabaseClient | null = null;

// Exported for the /agents panel API routes; agents themselves should use the
// typed helpers below instead of the raw client.
export function getAgentClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing for agent substrate");
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

// Mode reads sit on cron hot paths (some run every minute), so cache briefly.
const MODE_CACHE_MS = 60_000;
const modeCache = new Map<string, { mode: AgentMode; fetchedAt: number }>();

// Fail-safe: unknown agent or DB error reads as "off". An agent that cannot
// prove it is armed does not act.
export async function getAgentMode(agentKey: string): Promise<AgentMode> {
  const hit = modeCache.get(agentKey);
  if (hit && Date.now() - hit.fetchedAt < MODE_CACHE_MS) return hit.mode;
  try {
    const { data, error } = await getAgentClient()
      .from("agent_registry")
      .select("mode")
      .eq("key", agentKey)
      .maybeSingle();
    if (error) throw error;
    const mode = (data?.mode as AgentMode | undefined) ?? "off";
    modeCache.set(agentKey, { mode, fetchedAt: Date.now() });
    return mode;
  } catch (err) {
    console.error(`[agent-substrate] mode read failed for ${agentKey}:`, err);
    return "off";
  }
}

// For agents that were ALREADY live before the registry existed: reads the
// mode but falls back to the given default when the row is missing or the
// read fails, so a lagging seed/migration can never silently stop a
// production loop. New agents must use getAgentMode (fail-safe to "off").
export async function getAgentModeOrDefault(agentKey: string, fallback: AgentMode): Promise<AgentMode> {
  const hit = modeCache.get(agentKey);
  if (hit && Date.now() - hit.fetchedAt < MODE_CACHE_MS) return hit.mode;
  try {
    const { data, error } = await getAgentClient()
      .from("agent_registry")
      .select("mode")
      .eq("key", agentKey)
      .maybeSingle();
    if (error) throw error;
    const mode = (data?.mode as AgentMode | undefined) ?? fallback;
    modeCache.set(agentKey, { mode, fetchedAt: Date.now() });
    return mode;
  } catch (err) {
    console.error(`[agent-substrate] mode read failed for ${agentKey}, using fallback ${fallback}:`, err);
    return fallback;
  }
}

// Heartbeat: call once per run (even a no-op run) so the panel can tell
// "healthy but quiet" from "stopped running".
export async function touchAgentRun(agentKey: string): Promise<void> {
  try {
    await getAgentClient()
      .from("agent_registry")
      .update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("key", agentKey);
  } catch (err) {
    console.error(`[agent-substrate] touchAgentRun failed for ${agentKey}:`, err);
  }
}

// Ledger write. Deliberately never throws — losing one telemetry row must
// never break the business action that just happened.
export async function logAgentAction(input: AgentActionInput): Promise<void> {
  try {
    const client = getAgentClient();
    // Derive tokens + cost from raw usage when the caller passed it and didn't
    // already compute them, so every LLM agent gets costed the same way.
    const derived =
      input.usage && input.model && input.costUsd == null
        ? costFromUsage(input.model, input.usage)
        : null;
    const { error } = await client.from("agent_actions").insert({
      agent_key: input.agentKey,
      kind: input.kind,
      summary: input.summary.slice(0, 500),
      ref_table: input.refTable ?? null,
      ref_id: input.refId ?? null,
      outlet_id: input.outletId ?? null,
      confidence: input.confidence ?? null,
      autonomous: input.autonomous ?? true,
      model: input.model ?? null,
      input_tokens: input.inputTokens ?? derived?.inputTokens ?? null,
      output_tokens: input.outputTokens ?? derived?.outputTokens ?? null,
      cost_usd: input.costUsd ?? derived?.costUsd ?? null,
      meta: input.meta ?? {},
    });
    if (error) throw error;
    await client
      .from("agent_registry")
      .update({ last_action_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("key", input.agentKey);
  } catch (err) {
    console.error(`[agent-substrate] logAgentAction failed for ${input.agentKey}:`, err);
  }
}

// Marks a prior action as human-overridden (reversed/edited). Callers pass the
// domain record pointer they stored at log time.
export async function markHumanOverride(refTable: string, refId: string): Promise<void> {
  try {
    await getAgentClient()
      .from("agent_actions")
      .update({ human_override: true })
      .eq("ref_table", refTable)
      .eq("ref_id", refId);
  } catch (err) {
    console.error(`[agent-substrate] markHumanOverride failed for ${refTable}/${refId}:`, err);
  }
}
