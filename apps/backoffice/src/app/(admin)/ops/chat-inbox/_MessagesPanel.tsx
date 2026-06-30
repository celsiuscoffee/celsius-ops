"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { ChatDateDivider } from "@/components/chat-date-divider";
import { mytDayKey, chatDayLabel } from "@/lib/chat-day";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Activity, ArrowUpRight, ArrowDownLeft, RefreshCw, AlertTriangle } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Kind = "pulse" | "nudge" | "scoreboard" | "reminder" | "instruction" | "audit" | "reply" | "manual" | "supplier" | "other";

type Msg = {
  id: string;
  direction: "in" | "out";
  kind: Kind;
  name: string | null;
  phone: string;
  body: string;
  status: string | null;
  type: string;
  at: string;
};
type Summary = { total: number; sent: number; failed: number; inbound: number; byKind: Record<string, number> };
type Payload = { messages: Msg[]; summary: Summary };

const KIND_LABEL: Record<Kind, string> = {
  pulse: "Pulse", nudge: "Nudge", scoreboard: "Scoreboard", reminder: "Reminder",
  instruction: "Instruction", audit: "Audit", reply: "Reply", manual: "Manual", supplier: "Supplier", other: "Other",
};
const KIND_CLASS: Record<Kind, string> = {
  pulse: "bg-red-100 text-red-700", nudge: "bg-amber-100 text-amber-700", scoreboard: "bg-violet-100 text-violet-700",
  reminder: "bg-blue-100 text-blue-700", instruction: "bg-teal-100 text-teal-700", audit: "bg-indigo-100 text-indigo-700",
  reply: "bg-green-100 text-green-700", manual: "bg-slate-100 text-slate-600", supplier: "bg-orange-100 text-orange-700", other: "bg-slate-100 text-slate-600",
};

const FILTER_KINDS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pulse", label: "Pulse" },
  { key: "nudge", label: "Nudges" },
  { key: "scoreboard", label: "Scoreboard" },
  { key: "reminder", label: "Reminders" },
  { key: "instruction", label: "Instructions" },
  { key: "audit", label: "Audits" },
  { key: "reply", label: "Replies" },
];

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtPhone(p: string): string {
  return /^60\d+$/.test(p) ? "+" + p : p;
}

export default function MessagesPanel() {
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [days, setDays] = useState("7");
  const [supplier, setSupplier] = useState(false);

  const url = useMemo(() => {
    const p = new URLSearchParams({ kind, status, days, supplier: supplier ? "1" : "0" });
    if (q.trim()) p.set("q", q.trim());
    return `/api/ops/workspace/messages?${p.toString()}`;
  }, [kind, status, days, supplier, q]);

  const { data, isLoading, mutate } = useFetch<Payload>(url);
  const messages = data?.messages ?? [];
  const s = data?.summary;

  // Keep the monitor live.
  useEffect(() => {
    const id = setInterval(() => mutate(), 20000);
    return () => clearInterval(id);
  }, [mutate]);

  return (
    <Card className="flex h-[calc(100vh-15rem)] flex-col p-4">
      {/* Header + summary */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Activity className="h-4 w-4 text-terracotta" />
        <span className="text-sm font-medium">Message monitor</span>
        {s && (
          <span className="text-xs text-muted-foreground">
            {s.sent} sent · {s.inbound} replies
            {s.failed > 0 && <span className="text-red-600"> · {s.failed} failed</span>}
            <span className="text-muted-foreground"> · last {days}d</span>
          </span>
        )}
        <button onClick={() => mutate()} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {FILTER_KINDS.map((k) => {
          const active = kind === k.key;
          const n = k.key === "all" ? undefined : s?.byKind[k.key];
          return (
            <button
              key={k.key}
              onClick={() => setKind(k.key)}
              className={
                "rounded-md border px-2 py-1 text-xs transition " +
                (active ? "border-terracotta bg-terracotta/10 text-terracotta" : "text-muted-foreground hover:text-foreground")
              }
            >
              {k.label}{n ? ` ${n}` : ""}
            </button>
          );
        })}
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-7 rounded-md border bg-background px-1.5 text-xs">
          <option value="all">Any status</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
        <select value={days} onChange={(e) => setDays(e.target.value)} className="h-7 rounded-md border bg-background px-1.5 text-xs">
          <option value="1">Today</option>
          <option value="7">7 days</option>
          <option value="30">30 days</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" checked={supplier} onChange={(e) => setSupplier(e.target.checked)} /> incl. supplier
        </label>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / phone / text…" className="h-7 w-44 text-xs" />
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && !data ? (
          <div className="p-6 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : messages.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No messages match these filters.</div>
        ) : (
          <ul className="space-y-1.5">
            {messages.map((m, i) => {
              const failed = m.status === "failed";
              const showDivider = i === 0 || mytDayKey(messages[i - 1].at) !== mytDayKey(m.at);
              return (
                <Fragment key={m.id}>
                {showDivider && (
                  <li>
                    <ChatDateDivider label={chatDayLabel(m.at)} />
                  </li>
                )}
                <li className={"rounded-lg border p-2.5 " + (failed ? "border-red-200 bg-red-50/40" : "bg-card")}>
                  <div className="flex items-center gap-1.5">
                    {m.direction === "out" ? (
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-green-600" />
                    )}
                    <Badge className={"text-[10px] " + KIND_CLASS[m.kind]}>{KIND_LABEL[m.kind]}</Badge>
                    <span className="truncate text-xs font-medium text-foreground">{m.name || fmtPhone(m.phone)}</span>
                    {failed && (
                      <span className="flex items-center gap-0.5 text-[10px] text-red-600"><AlertTriangle className="h-3 w-3" /> failed</span>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{fmt(m.at)}</span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words pl-5 text-xs text-muted-foreground line-clamp-4">{m.body || `<${m.type}>`}</div>
                </li>
                </Fragment>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
