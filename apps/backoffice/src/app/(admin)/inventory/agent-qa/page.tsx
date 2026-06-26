"use client";

import { useState } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import {
  ShieldCheck,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

type Verdict = {
  rating: "pass" | "concern" | "fail";
  confidence: number;
  issues: string[];
  summary: string;
  recommendedAction: string | null;
};

type Row = {
  messageId: string;
  at: string;
  key: string;
  supplierName: string;
  poNumber: string | null;
  intent: string;
  actionType: string;
  appliedAction: string;
  escalated: boolean;
  confidence: number;
  reSourced: boolean;
  hasSnapshot: boolean;
  verifier: Verdict | null;
};

type Data = {
  enabled: boolean;
  counts: {
    total: number;
    escalated: number;
    autoActed: number;
    verified: number;
    unverified: number;
    pass: number;
    concern: number;
    fail: number;
  };
  rows: Row[];
};

function rel(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

function RatingChip({ v }: { v: Verdict | null }) {
  if (!v)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
        unchecked
      </span>
    );
  const map = {
    pass: { cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300", icon: <CheckCircle2 size={11} />, label: "pass" },
    concern: { cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300", icon: <CircleAlert size={11} />, label: "concern" },
    fail: { cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300", icon: <AlertTriangle size={11} />, label: "fail" },
  }[v.rating];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${map.cls}`}>
      {map.icon} {map.label}
    </span>
  );
}

function Card({ label, value, tone }: { label: string; value: number; tone?: "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-600 dark:text-red-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export default function AgentQaPage() {
  const { data, mutate } = useFetch<Data>("/api/inventory/agent-qa", {
    refreshInterval: 15000,
    revalidateOnFocus: true,
  });
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function runChecks() {
    if (running) return;
    setRunning(true);
    setNote(null);
    try {
      const res = await fetch("/api/inventory/agent-qa", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (json.enabled === false) setNote(json.error ?? "Verifier is off.");
      else setNote(`Checked ${json.verified ?? 0} — ${json.fail ?? 0} fail, ${json.concern ?? 0} concern, ${json.pass ?? 0} pass.`);
      mutate();
    } catch {
      setNote("Run failed — network error.");
    } finally {
      setRunning(false);
    }
  }

  const c = data?.counts;
  const rows = data?.rows ?? [];
  const flagged = (c?.concern ?? 0) + (c?.fail ?? 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <ShieldCheck size={20} /> Agent QA
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            An independent AI verifier grades the supplier-chat agent&apos;s decisions. Flags only — it never changes a PO or messages a supplier.
          </p>
        </div>
        <button
          onClick={runChecks}
          disabled={running}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          Run checks
        </button>
      </div>

      {data && !data.enabled && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Verifier is in shadow mode and currently <span className="font-semibold">off</span>. Set <code>PROCUREMENT_VERIFIER_ENABLED=true</code> and <code>ANTHROPIC_API_KEY</code> to enable grading. Past decisions are still listed below.
        </div>
      )}
      {note && <div className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-[12px]">{note}</div>}

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Card label="Decisions" value={c?.total ?? 0} />
        <Card label="Auto-acted" value={c?.autoActed ?? 0} />
        <Card label="Escalated" value={c?.escalated ?? 0} />
        <Card label="Verified" value={c?.verified ?? 0} />
        <Card label="Flagged" value={flagged} tone={flagged > 0 ? "bad" : undefined} />
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        {rows.length === 0 && (
          <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">No agent decisions yet.</div>
        )}
        {rows.map((r) => {
          const open = expanded === r.messageId;
          return (
            <div key={r.messageId} className="border-b border-border last:border-b-0">
              <button
                onClick={() => setExpanded(open ? null : r.messageId)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
              >
                {open ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
                <RatingChip v={r.verifier} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">
                    {r.supplierName}
                    {r.poNumber && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{r.poNumber}</span>}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {r.intent}
                    {" · "}
                    {r.escalated ? "escalated" : r.appliedAction !== "none" ? `auto: ${r.appliedAction}` : "no PO change"}
                    {r.reSourced && " · re-sourced"}
                  </div>
                </div>
                <div className="shrink-0 text-right text-[10.5px] text-muted-foreground">
                  <div>conf {r.confidence.toFixed(2)}</div>
                  <div>{rel(r.at)}</div>
                </div>
              </button>

              {open && (
                <div className="space-y-2 border-t border-border bg-muted/30 px-3 py-3 pl-9 text-[12px]">
                  {r.verifier ? (
                    <>
                      <div>
                        <span className="font-medium">Verdict:</span> {r.verifier.summary || "—"}{" "}
                        <span className="text-muted-foreground">(verifier conf {r.verifier.confidence.toFixed(2)})</span>
                      </div>
                      {r.verifier.issues.length > 0 && (
                        <ul className="ml-4 list-disc space-y-0.5 text-foreground">
                          {r.verifier.issues.map((iss, i) => (
                            <li key={i}>{iss}</li>
                          ))}
                        </ul>
                      )}
                      {r.verifier.recommendedAction && (
                        <div className="rounded border border-border bg-card px-2 py-1.5">
                          <span className="font-medium">Recommended:</span> {r.verifier.recommendedAction}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-muted-foreground">
                      {r.hasSnapshot ? "Not yet checked — click “Run checks”." : "No snapshot (decision predates the verifier)."}
                    </div>
                  )}
                  {r.key && (
                    <Link
                      href={`/inventory/supplier-chats?key=${r.key}`}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      Open chat <ExternalLink size={11} />
                    </Link>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
