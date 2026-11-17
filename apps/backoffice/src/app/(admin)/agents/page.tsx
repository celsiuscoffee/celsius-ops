"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyNumber } from "@/components/ui/key-number";
import {
  ChevronDown,
  ChevronRight,
  CircleOff,
  Eye,
  Zap,
  AlertTriangle,
  RefreshCw,
  Send,
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

interface MessageRow {
  id: string;
  at: string;
  from_agent: string;
  to_agent: string | null;
  kind: "handoff" | "learning" | "logic_change" | "report" | "correction" | "note";
  summary: string;
  detail: string | null;
  outlet_id: string | null;
  fromLabel: string;
  toLabel: string | null;
}

const KIND_META: Record<MessageRow["kind"], { label: string; emoji: string; classes: string }> = {
  handoff: { label: "Handoff", emoji: "🔁", classes: "bg-info-soft text-info-text" },
  correction: { label: "Correction", emoji: "🛠", classes: "bg-danger-soft text-danger-text" },
  learning: { label: "Learned", emoji: "🧠", classes: "bg-info-soft text-info-text" },
  logic_change: { label: "Logic change", emoji: "⚙️", classes: "bg-warn-soft text-warn-text" },
  report: { label: "Report", emoji: "📣", classes: "bg-ok-soft text-ok-text" },
  note: { label: "Your note", emoji: "💬", classes: "bg-sunken text-text-2" },
};

const MODE_META: Record<AgentMode, { label: string; classes: string; icon: React.ReactNode }> = {
  off: { label: "Off", classes: "bg-sunken text-text-2", icon: <CircleOff className="h-3.5 w-3.5" /> },
  shadow: { label: "Shadow", classes: "bg-warn-soft text-warn-text", icon: <Eye className="h-3.5 w-3.5" /> },
  armed: { label: "Armed", classes: "bg-ok-soft text-ok-text", icon: <Zap className="h-3.5 w-3.5" /> },
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
  const [view, setView] = useState<"fleet" | "conversations">("fleet");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [msgKind, setMsgKind] = useState<string>("");
  const [msgLoading, setMsgLoading] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  const [tgStatus, setTgStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function connectTelegram() {
    setTgBusy(true);
    setTgStatus(null);
    try {
      const res = await fetch("/api/agents/pulse-webhook/register", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        // The register route returns a plain-English reason when an env var is
        // still missing (bot token / webhook secret / app url).
        throw new Error(json.error || "Registration failed");
      }
      setTgStatus({ ok: true, text: "Connected. Replies and button taps now reach the agents." });
    } catch (e) {
      setTgStatus({ ok: false, text: e instanceof Error ? e.message : "Registration failed" });
    } finally {
      setTgBusy(false);
    }
  }

  const loadMessages = useCallback(async (kind: string) => {
    setMsgLoading(true);
    try {
      const res = await fetch(`/api/agents/messages${kind ? `?kind=${kind}` : ""}`);
      const json = await res.json();
      if (res.ok) setMessages(json.messages);
    } finally {
      setMsgLoading(false);
    }
  }, []);

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
    <div className="px-4 pt-6 pb-10 md:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">AI agents</h1>
          <p className="mt-0.5 text-sm text-text-2">
            Which agents act on their own, which only watch, what they cost, and what they tell each other.
          </p>
        </div>
        <div className="flex flex-col gap-1.5 sm:items-end">
          <div className="flex items-center gap-2">
            <button
              onClick={() => void connectTelegram()}
              disabled={tgBusy}
              title="Register the Telegram webhook so your replies and button taps reach the agents. Set CELSIUS_PULSE_WEBHOOK_SECRET first."
              className="flex h-10 items-center gap-1.5 rounded-ctl border border-line-2 bg-surface px-3 text-sm text-text hover:bg-sunken disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> {tgBusy ? "Connecting…" : "Connect Telegram"}
            </button>
            <button
              onClick={() => (view === "fleet" ? void load() : void loadMessages(msgKind))}
              className="flex h-10 items-center gap-1.5 rounded-ctl border border-line-2 bg-surface px-3 text-sm text-text hover:bg-sunken"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>
          {tgStatus && (
            <p className={`max-w-xs text-xs sm:text-right ${tgStatus.ok ? "text-ok-text" : "text-warn-text"}`}>
              {tgStatus.text}
            </p>
          )}
        </div>
      </div>

      <div className="mb-5 flex gap-6 border-b border-line">
        {([["fleet", "Agents"], ["conversations", "What they said"]] as const).map(([k, l]) => (
          <button key={k}
            onClick={() => { setView(k); if (k === "conversations" && messages.length === 0) void loadMessages(msgKind); }}
            className={`-mb-px min-h-10 border-b-2 text-sm transition-colors ${view === k ? "border-text font-semibold text-text" : "border-transparent text-text-2 hover:text-text"}`}>
            {l}
          </button>
        ))}
      </div>

      {view === "conversations" && (
        <Conversations
          messages={messages}
          loading={msgLoading}
          activeKind={msgKind}
          onKind={(k) => {
            setMsgKind(k);
            void loadMessages(k);
          }}
        />
      )}

      {view === "fleet" && (
      <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber label="Acting on their own" value={loading ? null : String(armed)} note={<>of <b className="font-semibold text-text-2">{agents.length}</b> agents</>} />
        <KeyNumber label="Watching only" value={loading ? null : String(shadow)} note="suggest, but change nothing" />
        <KeyNumber label="No rule for going live" value={loading ? null : String(noCriteria)} tone={noCriteria ? "warn" : undefined}
          note={noCriteria ? "running without arming criteria" : "every running agent has one"} />
        <KeyNumber label="Cost, last 30 days" value={loading ? null : usd(actual30d)} note={<>about <b className="font-semibold text-text-2">{usd(estMonthly)}</b> a month expected</>} />
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-card bg-danger-soft px-4 py-3 text-sm text-danger-text">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}
      {loading && <div className="py-12 text-center text-sm text-text-3">Loading fleet…</div>}
      {!loading && agents.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-line-2 bg-surface px-6 py-12 text-center text-sm text-text-2">
          Registry is empty — run the seed (see migration 080 + docs/design/agent-substrate.md).
        </div>
      )}

      {Object.entries(byDomain).map(([domain, rows]) => (
        <div key={domain} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-text">
            {DOMAIN_LABELS[domain] ?? domain}
          </h2>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
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
          </div>
        </div>
      ))}
      </>
      )}
    </div>
  );
}

// The Conversations feed: plain-English record of what agents tell each other,
// what they learn, and when their logic changes. Same data the pulse Telegram
// channel receives, always live here regardless of Telegram config.
function Conversations({
  messages,
  loading,
  activeKind,
  onKind,
}: {
  messages: MessageRow[];
  loading: boolean;
  activeKind: string;
  onKind: (k: string) => void;
}) {
  const FILTERS: { key: string; label: string }[] = [
    { key: "", label: "All" },
    { key: "handoff", label: "🔁 Handoffs" },
    { key: "correction", label: "🛠 Corrections" },
    { key: "learning", label: "🧠 Learnings" },
    { key: "logic_change", label: "⚙️ Logic changes" },
    { key: "report", label: "📣 Reports" },
    { key: "note", label: "💬 Your notes" },
  ];
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => onKind(f.key)}
            className={`min-h-9 rounded-full px-3 text-xs transition-colors ${
              activeKind === f.key ? "border border-text bg-raised font-semibold text-text" : "bg-surface text-text-2 border border-line hover:bg-sunken"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <div className="py-12 text-center text-sm text-text-3">Loading conversations…</div>}
      {!loading && messages.length === 0 && (
        <div className="rounded-xl border border-dashed border-line-2 bg-surface px-6 py-12 text-center text-sm text-text-2">
          No agent communications yet. They appear here (and on the pulse Telegram channel) as agents hand work
          to each other, learn from corrections, or change mode.
        </div>
      )}
      {!loading && messages.length > 0 && (
        <ul className="space-y-2">
          {messages.map((m) => {
            const meta = KIND_META[m.kind];
            return (
              <li key={m.id} className="rounded-card border border-line bg-surface px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="font-semibold text-text">{m.fromLabel}</span>
                    {m.toLabel && (
                      <>
                        <span className="text-text-3">→</span>
                        <span className="font-semibold text-text">{m.toLabel}</span>
                      </>
                    )}
                    <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.classes}`}>
                      {meta.emoji} {meta.label}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-text-3">{timeAgo(m.at)}</span>
                </div>
                <p className="mt-1 text-sm text-text-2">{m.summary}</p>
                {m.detail && <p className="mt-0.5 text-xs text-text-3">{m.detail}</p>}
              </li>
            );
          })}
        </ul>
      )}
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
    <div className="border-b border-line last:border-b-0">
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <button onClick={onExpand} className="flex min-w-0 flex-1 items-start gap-1.5 text-left">
          {expanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-text-3" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium text-text">{agent.name}</span>
              {!agent.arming_criteria && agent.mode !== "off" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn-text">
                  <AlertTriangle className="h-3 w-3" /> no rule for going live
                </span>
              )}
            </span>
            <span className="mt-0.5 block text-[12px] text-text-3">
              {agent.kind}{agent.trigger_detail ? ` ${agent.trigger_detail}` : ""}
              {" · "}{agent.uses_llm ? (agent.model ?? "AI model") : "rules"}
              {" · last ran "}{timeAgo(agent.last_run_at)}
              {" · "}{agent.week.total} actions this week{agent.week.overridden > 0 ? `, ${agent.week.overridden} overridden` : ""}
              {agent.actualCost30d > 0 ? ` · ${usd(agent.actualCost30d)} in 30 days` : ""}
            </span>
          </span>
        </button>
        <div className="inline-flex shrink-0 self-start overflow-hidden rounded-ctl border border-line sm:self-center">
          {(["off", "shadow", "armed"] as AgentMode[]).map((m) => (
            <button
              key={m}
              disabled={saving}
              onClick={() => onSetMode(m)}
              className={`flex min-h-9 items-center gap-1 px-3 text-xs font-medium transition-colors ${
                agent.mode === m ? MODE_META[m].classes : "bg-surface text-text-3 hover:text-text-2"
              } ${saving ? "opacity-50" : ""}`}
            >
              {MODE_META[m].icon} {MODE_META[m].label}
            </button>
          ))}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-line bg-sunken/40 px-4 py-4 sm:px-11">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 text-sm">
                <p className="text-text-2">{agent.description || "No description."}</p>
                <Detail label="Arming criteria">
                  {agent.arming_criteria ? (
                    <>
                      {agent.arming_criteria}
                      {agent.arming_review_date && (
                        <span className="ml-1 text-text-3">(review {agent.arming_review_date})</span>
                      )}
                    </>
                  ) : (
                    <span className="text-danger-text">Not set — this agent cannot be armed until it is.</span>
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
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-3">
                  Recent actions
                </div>
                {!actions && <div className="text-xs text-text-3">Loading…</div>}
                {actions && actions.length === 0 && (
                  <div className="text-xs text-text-3">No ledger entries yet.</div>
                )}
                {actions && actions.length > 0 && (
                  <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-2">
                    {actions.map((x) => (
                      <li key={x.id} className="rounded-lg border border-line bg-surface px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-text-2">{x.kind}</span>
                          <span className="text-text-3">{timeAgo(x.at)}</span>
                        </div>
                        <div className="mt-0.5 text-text-2">{x.summary}</div>
                        <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-text-3">
                          {x.outlet_id && <span>outlet {x.outlet_id.slice(0, 8)}</span>}
                          {x.confidence != null && <span>conf {Number(x.confidence).toFixed(2)}</span>}
                          {!x.autonomous && <span className="text-info-text">human-initiated</span>}
                          {x.human_override && <span className="text-danger-text">overridden</span>}
                          {x.cost_usd != null && <span>${Number(x.cost_usd).toFixed(4)}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-text-3">{label}</div>
      <div className="mt-0.5 text-text-2">{children}</div>
    </div>
  );
}
