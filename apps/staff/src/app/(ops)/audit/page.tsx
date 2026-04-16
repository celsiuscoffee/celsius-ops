"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardCheck, Loader2, CheckCircle2, Clock, Plus, ChevronRight, Building2,
  Sparkles, AlertTriangle, AlertCircle, Info,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type UserProfile = { id: string; name: string; role: string; outletId: string | null; moduleAccess?: Record<string, boolean> };
type Outlet = { id: string; name: string; code: string };
type Template = {
  id: string; name: string; description: string | null; roleType: string;
  sections: { id: string; name: string; _count: { items: number } }[];
};
type AuditSummary = {
  id: string; date: string; status: string; overallScore: number | null;
  completedAt: string | null;
  template: { id: string; name: string; roleType: string };
  outlet: { id: string; name: string; code: string };
  auditor: { id: string; name: string };
  isMine: boolean;
  totalItems: number; completedItems: number; progress: number;
};
type Insight = {
  severity: "high" | "medium" | "low";
  finding: string;
  action: string;
  category: string;
};
type InsightsResponse = {
  focus: string;
  summary: string;
  insights: Insight[];
  basedOnAudits: number;
  lastAuditDate: string | null;
};

const SEVERITY_CONFIG = {
  high: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50", border: "border-red-200", label: "High priority" },
  medium: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", label: "Watch" },
  low: { icon: Info, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", label: "Note" },
} as const;

export default function AuditPage() {
  const router = useRouter();
  const { data: me } = useFetch<UserProfile>("/api/auth/me");
  const { data: audits, isLoading, mutate } = useFetch<AuditSummary[]>("/api/audits");
  const { data: templates } = useFetch<Template[]>("/api/audits/templates");
  const { data: outlets } = useFetch<Outlet[]>("/api/audits/outlets");
  const { data: insights, isLoading: insightsLoading } = useFetch<InsightsResponse>(
    me?.outletId ? `/api/audits/insights?outletId=${me.outletId}` : null,
  );

  const [showNew, setShowNew] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedOutlet, setSelectedOutlet] = useState("");
  const [creating, setCreating] = useState(false);
  const [insightsExpanded, setInsightsExpanded] = useState(true);

  const inProgress = audits?.filter((a) => a.status === "IN_PROGRESS") ?? [];
  const completed = audits?.filter((a) => a.status === "COMPLETED") ?? [];

  const handleCreate = async () => {
    if (!selectedTemplate || !selectedOutlet) return;
    setCreating(true);
    try {
      const res = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: selectedTemplate, outletId: selectedOutlet }),
      });
      const data = await res.json();
      if (res.ok) {
        mutate();
        setShowNew(false);
        setSelectedTemplate("");
        setSelectedOutlet("");
        router.push(`/audit/${data.id}`);
      }
    } finally {
      setCreating(false);
    }
  };

  const totalItems = (t: Template) => t.sections.reduce((s, sec) => s + sec._count.items, 0);

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-lg font-bold text-brand-dark">Audits</h1>
          <p className="text-sm text-gray-500">Spot checks & quality audits</p>
        </div>
        <Button size="sm" onClick={() => setShowNew(!showNew)} className="bg-terracotta hover:bg-terracotta-dark text-xs">
          <Plus className="mr-1 h-3.5 w-3.5" /> New Audit
        </Button>
      </div>

      {/* AI Coach — Today's Focus */}
      {(insightsLoading || (insights && insights.insights.length > 0)) && (
        <Card className="p-3 border-terracotta/20 bg-gradient-to-br from-terracotta/5 to-transparent">
          <button
            onClick={() => setInsightsExpanded((v) => !v)}
            className="flex w-full items-center gap-2 text-left"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-terracotta/10">
              <Sparkles className="h-4 w-4 text-terracotta" />
            </div>
            <div className="flex-1 min-w-0">
              {insightsLoading ? (
                <>
                  <p className="text-xs font-semibold text-gray-900">AI Coach analyzing...</p>
                  <p className="text-[10px] text-gray-400">Reviewing your recent audits</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-gray-900">{insights?.focus}</p>
                  <p className="text-[10px] text-gray-500 truncate">{insights?.summary}</p>
                </>
              )}
            </div>
            {insightsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-terracotta shrink-0" />
            ) : (
              <ChevronRight className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${insightsExpanded ? "rotate-90" : ""}`} />
            )}
          </button>

          {insightsExpanded && insights && insights.insights.length > 0 && (
            <div className="mt-3 space-y-2">
              {insights.insights.map((insight, idx) => {
                const cfg = SEVERITY_CONFIG[insight.severity];
                const Icon = cfg.icon;
                return (
                  <div
                    key={idx}
                    className={`rounded-lg border ${cfg.border} ${cfg.bg} p-2.5`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className={`h-4 w-4 ${cfg.color} shrink-0 mt-0.5`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`text-[9px] font-bold uppercase tracking-wider ${cfg.color}`}>
                            {cfg.label}
                          </span>
                          <span className="text-[9px] text-gray-400">·</span>
                          <span className="text-[10px] text-gray-500">{insight.category}</span>
                        </div>
                        <p className="text-xs text-gray-800 leading-snug">{insight.finding}</p>
                        <p className="text-[11px] text-gray-600 mt-1.5 leading-snug">
                          <span className="font-semibold">→</span> {insight.action}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
              {insights.basedOnAudits > 0 && (
                <p className="text-[10px] text-gray-400 text-center pt-1">
                  Based on {insights.basedOnAudits} audit{insights.basedOnAudits > 1 ? "s" : ""} in the last 30 days
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      {/* New Audit Form */}
      {showNew && (
        <Card className="p-4 space-y-3 border-terracotta/30">
          <h3 className="text-sm font-semibold text-gray-900">Start New Audit</h3>

          {/* Select Template */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Template</label>
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
            >
              <option value="">Select template...</option>
              {templates?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({totalItems(t)} items)
                </option>
              ))}
            </select>
          </div>

          {/* Select Outlet */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Outlet</label>
            <select
              value={selectedOutlet}
              onChange={(e) => setSelectedOutlet(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
            >
              <option value="">Select outlet...</option>
              {outlets?.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowNew(false)} className="text-xs flex-1">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!selectedTemplate || !selectedOutlet || creating}
              className="bg-terracotta hover:bg-terracotta-dark text-xs flex-1"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Start Audit
            </Button>
          </div>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      )}

      {/* In Progress */}
      {inProgress.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">In Progress</h2>
          <div className="space-y-2">
            {inProgress.map((audit) => (
              <Link key={audit.id} href={`/audit/${audit.id}`}>
                <Card className="px-3 py-2.5 transition-all active:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100">
                      <Clock className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-gray-900 truncate">{audit.template.name}</p>
                        {audit.isMine && (
                          <Badge className="text-[9px] bg-terracotta/10 text-terracotta border-none shrink-0">You</Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                        <Building2 className="h-2.5 w-2.5" />
                        <span className="truncate">{audit.auditor.name} · {audit.date} · {audit.completedItems}/{audit.totalItems}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-700">{audit.progress}%</span>
                      <ChevronRight className="h-4 w-4 text-gray-300" />
                    </div>
                  </div>
                  <div className="mt-2 rounded-full bg-gray-100 h-1 overflow-hidden">
                    <div className="h-full rounded-full bg-terracotta transition-all" style={{ width: `${audit.progress}%` }} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Completed (recent) */}
      {completed.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Completed</h2>
          <div className="space-y-2">
            {completed.slice(0, 5).map((audit) => (
              <Link key={audit.id} href={`/audit/${audit.id}`}>
                <Card className="px-3 py-2.5 transition-all active:bg-gray-50 opacity-80">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-100">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-gray-900 truncate">{audit.template.name}</p>
                        {audit.isMine && (
                          <Badge className="text-[9px] bg-terracotta/10 text-terracotta border-none shrink-0">You</Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                        <Building2 className="h-2.5 w-2.5" />
                        <span className="truncate">{audit.auditor.name} · {audit.date}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right flex items-center gap-2">
                      <Badge className={`text-[10px] ${(audit.overallScore ?? 0) >= 80 ? "bg-green-100 text-green-700" : (audit.overallScore ?? 0) >= 60 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>
                        {audit.overallScore ?? 0}%
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-gray-300" />
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!audits || audits.length === 0) && !showNew && (
        <Card className="px-4 py-8 text-center">
          <ClipboardCheck className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No audits yet</p>
          <p className="mt-1 text-xs text-gray-400">Tap &quot;New Audit&quot; to start a spot check</p>
        </Card>
      )}

      {/* History link */}
      {completed.length > 5 && (
        <Link href="/audit/history" className="block text-center text-xs text-terracotta py-2">
          View all history →
        </Link>
      )}
    </div>
  );
}
