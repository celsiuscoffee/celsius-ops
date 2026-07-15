"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleOff,
  Eye,
  Zap,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

// /agents — the fleet control panel. One row per autonomous actor from
// agent_registry: mode (the DB-backed kill switch), heartbeat, 7-day action
// volume, and an inline expansion with arming criteria + the recent ledger.
// Full-width inline detail by design — no drawers.

type AgentMode = "off" | "shadow" | "armed";

interface AgentRow {
  key: string;
  name: string;
  domain: string;
  description: string;
  mode: AgentMode;
  kind: string;
  trigger_detail: string | null;
  uses_llm: boolean;
  model: string | null;
  arming_criteria: string | null;
  arming_review_date: string | null;
  kill_switch_note: string | null;
  code_path: string | null;
  last_run_at: string | null;
  last_action_at: string | null;
  week: { total: number; autonomous: number; overridden: number };
  estCost: { perRun: number; perMonth: number };
  actualCost30d: number;
}

interface ActionRow {
  id: string;
  at: string;
  kind: string;
  summary: string;
  outlet_id: string | null;
  confidence: number | null;
  autonomous: boolean;
  human_override: boolean | null;
  model: string | null;
  cost_usd: number | null;
}

const MODE_META: Record<AgentMode, { label: string; classes: string; icon: React.ReactNode }> = {
  off: { label: "Off", classes: "bg-gray-100 text-gray-600", icon: <CircleOff className="h-3.5 w-3.5" /> },
  shadow: { label: "Shadow", classes: "bg-amber-50 text-amber-700", icon: <Eye className="h-3.5 w-3.5" /> },
  armed: { label: "Armed", classes: "bg-emerald-50 text-emerald-700", icon: <Zap className="h-3.5 w-3.5" /> },
};

const DOMAIN_LABELS: Record<string, string> = {
  finance: "Finance",
  reviews: "Reviews & GBP",
  marketing: "Marketing",
  loyalty: "Loyalty",
  procurement: "Procurement",
  hr: "HR & People",
  ops: "Operations",
  pos: "POS & Merchandising",
};

function usd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actions, setActions] = useState<Record<string, ActionRow[]>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/registry");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setAgents(json.agents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleExpand(key: string) {
    const next = expanded === key ? null : key;
    setExpanded(next);
    if (next && !actions[next]) {
      const res = await fetch(`/api/agents/actions?key=${encodeURIComponent(next)}`);
      const json = await res.json();
      if (res.ok) setActions((prev) => ({ ...prev, [next]: json.actions }));
    }
  }

  async function setMode(agent: AgentRow, mode: AgentMode) {
    if (mode === agent.mode) return;
    if (
      mode === "armed" &&
      !window.confirm(`Arm "${agent.name}"? It will act autonomously on its trigger (${agent.trigger_detail || agent.kind}).`)
    ) {
      return;
    }
    setSaving(agent.key);
    try {
      const res = await fetch("/api/agents/registry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: agent.key, mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update");
      setAgents((prev) => prev.map((a) => (a.key === agent.key ? { ...a, mode } : a)));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(null);
    }
  }

  const byDomain = agents.reduce<Record<string, AgentRow[]>>((acc, a) => {
    (acc[a.domain] ??= []).push(a);
    return acc;
  }, {});
  const armed = agents.filter((a) => a.mode === "armed").length;
  const shadow = agents.filter((a) => a.mode === "shadow").length;
  const noCriteria = agents.filter((a) => a.mode !== "off" && !a.arming_criteria).length;
  // Only armed/shadow agents actually run, so only they carry a live cost.
  const estMonthly = agents
    .filter((a) => a.mode !== "off")
    .reduce((sum, a) => sum + (a.estCost?.perMonth ?? 0), 0);
  const actual30d = agents.reduce((sum, a) => sum + (a.actualCost30d ?? 0), 0);

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
            <Bot className="h-5 w-5 text-gray-500" /> AI Agents
          </h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Every autonomous actor, its mode, and its action ledger. Arming requires written arming criteria.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total agents" value={agents.length} />
        <Stat label="Armed" value={armed} accent="text-emerald-700" />
        <Stat label="Shadow" value={shadow} accent="text-amber-700" />
        <Stat label="Active w/o arming criteria" value={noCriteria} accent={noCriteria ? "text-red-600" : undefined} />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TextStat label="Est. API cost / month" value={usd(estMonthly)} sub="running agents, at current token estimates" />
        <TextStat label="Actual API cost / 30d" value={usd(actual30d)} sub="from the action ledger" accent="text-gray-900" />
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}
      {loading && <div className="py-12 text-center text-sm text-gray-400">Loading fleet…</div>}
      {!loading && agents.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center text-sm text-gray-500">
          Registry is empty — run the seed (see migration 080 + docs/design/agent-substrate.md).
        </div>
      )}

      {Object.entries(byDomain).map(([domain, rows]) => (
        <div key={domain} className="mb-6">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            {DOMAIN_LABELS[domain] ?? domain}
          </h3>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-2.5 font-medium">Agent</th>
                  <th className="px-4 py-2.5 font-medium">Mode</th>
                  <th className="px-4 py-2.5 font-medium">Trigger</th>
                  <th className="px-4 py-2.5 font-medium">LLM</th>
                  <th className="px-4 py-2.5 font-medium">Last run</th>
                  <th className="px-4 py-2.5 font-medium">7-day actions</th>
                  <th className="px-4 py-2.5 font-medium">Est / run</th>
                  <th className="px-4 py-2.5 font-medium">Est / month</th>
                  <th className="px-4 py-2.5 font-medium">Actual 30d</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <AgentRowView
                    key={a.key}
                    agent={a}
                    expanded={expanded === a.key}
                    saving={saving === a.key}
                    actions={actions[a.key]}
                    onExpand={() => void toggleExpand(a.key)}
                    onSetMode={(m) => void setMode(a, m)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className={`text-2xl font-semibold ${accent ?? "text-gray-900"}`}>{value}</div>
      <div className="mt-0.5 text-xs text-gray-500">{label}</div>
    </div>
  );
}

function TextStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-0.5 text-2xl font-semibold ${accent ?? "text-gray-900"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}

function AgentRowView({
  agent,
  expanded,
  saving,
  actions,
  onExpand,
  onSetMode,
}: {
  agent: AgentRow;
  expanded: boolean;
  saving: boolean;
  actions?: ActionRow[];
  onExpand: () => void;
  onSetMode: (m: AgentMode) => void;
}) {
  return (
    <>
      <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
        <td className="px-4 py-3">
          <button onClick={onExpand} className="flex items-start gap-1.5 text-left">
            {expanded ? (
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
            ) : (
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
            )}
            <span>
              <span className="font-medium text-gray-900">{agent.name}</span>
              {!agent.arming_criteria && agent.mode !== "off" && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
                  <AlertTriangle className="h-3 w-3" /> no arming criteria
                </span>
              )}
            </span>
          </button>
        </td>
        <td className="px-4 py-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
            {(["off", "shadow", "armed"] as AgentMode[]).map((m) => (
              <button
                key={m}
                disabled={saving}
                onClick={() => onSetMode(m)}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors ${
                  agent.mode === m ? MODE_META[m].classes : "bg-white text-gray-400 hover:text-gray-600"
                } ${saving ? "opacity-50" : ""}`}
              >
                {MODE_META[m].icon} {MODE_META[m].label}
              </button>
            ))}
          </div>
        </td>
        <td className="px-4 py-3 text-gray-600">
          <span className="text-xs">{agent.kind}</span>
          {agent.trigger_detail && (
            <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-500">
              {agent.trigger_detail}
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          {agent.uses_llm ? (
            <span className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[11px] text-violet-700">
              {agent.model ?? "LLM"}
            </span>
          ) : (
            <span className="text-xs text-gray-400">rules</span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-gray-500">{timeAgo(agent.last_run_at)}</td>
        <td className="px-4 py-3 text-xs text-gray-600">
          {agent.week.total}
          {agent.week.overridden > 0 && (
            <span className="ml-1.5 text-red-600">({agent.week.overridden} overridden)</span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-gray-600">
          {agent.uses_llm && agent.estCost.perRun > 0 ? usd(agent.estCost.perRun) : <span className="text-gray-300">-</span>}
        </td>
        <td className="px-4 py-3 text-xs text-gray-600">
          {agent.mode !== "off" && agent.estCost.perMonth > 0 ? usd(agent.estCost.perMonth) : <span className="text-gray-300">-</span>}
        </td>
        <td className="px-4 py-3 text-xs text-gray-700">
          {agent.actualCost30d > 0 ? usd(agent.actualCost30d) : <span className="text-gray-300">-</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-50 bg-gray-50/40 last:border-0">
          <td colSpan={9} className="px-4 py-4 sm:px-11">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 text-sm">
                <p className="text-gray-700">{agent.description || "No description."}</p>
                <Detail label="Arming criteria">
                  {agent.arming_criteria ? (
                    <>
                      {agent.arming_criteria}
                      {agent.arming_review_date && (
                        <span className="ml-1 text-gray-400">(review {agent.arming_review_date})</span>
                      )}
                    </>
                  ) : (
                    <span className="text-red-600">Not set — this agent cannot be armed until it is.</span>
                  )}
                </Detail>
                {agent.uses_llm && agent.estCost.perRun > 0 && (
                  <Detail label="Expected cost">
                    {usd(agent.estCost.perRun)}/run, {usd(agent.estCost.perMonth)}/month at current token estimates ({agent.model}). Actual last 30 days: {usd(agent.actualCost30d)}.
                  </Detail>
                )}
                {agent.kill_switch_note && (
                  <Detail label="Legacy kill switch">{agent.kill_switch_note}</Detail>
                )}
                {agent.code_path && (
                  <Detail label="Code">
                    <span className="font-mono text-xs">{agent.code_path}</span>
                  </Detail>
                )}
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Recent actions
                </div>
                {!actions && <div className="text-xs text-gray-400">Loading…</div>}
                {actions && actions.length === 0 && (
                  <div className="text-xs text-gray-400">No ledger entries yet.</div>
                )}
                {actions && actions.length > 0 && (
                  <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-2">
                    {actions.map((x) => (
                      <li key={x.id} className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-gray-700">{x.kind}</span>
                          <span className="text-gray-400">{timeAgo(x.at)}</span>
                        </div>
                        <div className="mt-0.5 text-gray-600">{x.summary}</div>
                        <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-gray-400">
                          {x.outlet_id && <span>outlet {x.outlet_id.slice(0, 8)}</span>}
                          {x.confidence != null && <span>conf {Number(x.confidence).toFixed(2)}</span>}
                          {!x.autonomous && <span className="text-blue-500">human-initiated</span>}
                          {x.human_override && <span className="text-red-500">overridden</span>}
                          {x.cost_usd != null && <span>${Number(x.cost_usd).toFixed(4)}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-0.5 text-gray-700">{children}</div>
    </div>
  );
}
