"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight, Target } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Me = { id: string; name: string };

type AuditEntry = {
  id: string;
  date: string;
  overallScore: number | null;
  scoreDelta: number | null;
  completedAt: string | null;
  auditor: { id: string; name: string };
  outlet: { id: string; name: string; code: string };
  items: Array<{
    itemTitle: string;
    sectionName: string;
    ratingType: string;
    rating: number | null;
    ratingDelta: number | null;
    notes: string | null;
  }>;
};

type Response = {
  auditee: { id: string; name: string } | null;
  templates: Array<{
    template: { id: string; name: string; jobRoleFilter: string[] };
    audits: AuditEntry[];
  }>;
};

function DeltaBadge({ delta, suffix = "" }: { delta: number | null; suffix?: string }) {
  if (delta === null)
    return <span className="text-[10px] text-gray-400">—</span>;
  if (delta === 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-500">
        <Minus className="h-2.5 w-2.5" />0{suffix}
      </span>
    );
  const positive = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${
        positive ? "text-green-600" : "text-red-600"
      }`}
    >
      {positive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {positive ? "+" : ""}{delta}{suffix}
    </span>
  );
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const points = values.filter((v): v is number => v !== null);
  if (points.length < 2) return null;
  const w = 280;
  const h = 50;
  const stepX = w / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = i * stepX;
      const y = h - (v / 100) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = points[points.length - 1];
  const lastX = (points.length - 1) * stepX;
  const lastY = h - (last / 100) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full text-terracotta">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx={lastX} cy={lastY} r="3" fill="currentColor" />
    </svg>
  );
}

export default function MySkillsPage() {
  const { data: me } = useFetch<Me>("/api/auth/me");
  const { data, isLoading } = useFetch<Response>(me ? `/api/audits/staff/${me.id}` : null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <Link
          href="/hr"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-4 w-4" />Back to HR
        </Link>
        <h1 className="font-heading text-lg font-bold text-brand-dark">My Skills</h1>
        <p className="text-sm text-gray-500">Your audit scores and how you&apos;re tracking over time.</p>
      </div>

      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      )}

      {data && data.templates.length === 0 && (
        <Card className="px-4 py-8 text-center">
          <Target className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No skill audits yet</p>
          <p className="mt-1 text-xs text-gray-400">
            Once a manager audits you, your scores will show up here.
          </p>
        </Card>
      )}

      {data?.templates.map(({ template, audits }) => {
        const latest = audits[audits.length - 1];
        const first = audits[0];
        const overallChange =
          latest?.overallScore !== null && first?.overallScore !== null && first !== latest
            ? Math.round((latest!.overallScore! - first!.overallScore!) * 100) / 100
            : null;
        const isExpanded = expanded[template.id] ?? false;

        return (
          <Card key={template.id} className="px-3 py-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{template.name}</p>
                <p className="text-[10px] text-gray-400">
                  {audits.length} audit{audits.length !== 1 ? "s" : ""}
                  {(template.jobRoleFilter ?? []).length > 0 ? ` · ${(template.jobRoleFilter ?? []).join(", ")}` : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xl font-semibold text-gray-900">
                  {latest?.overallScore ?? 0}<span className="text-xs text-gray-400">%</span>
                </p>
                {overallChange !== null && audits.length > 1 && (
                  <DeltaBadge delta={overallChange} suffix="% overall" />
                )}
              </div>
            </div>

            <Sparkline values={audits.map((a) => a.overallScore)} />

            <div className="border-t border-gray-100 pt-2 space-y-1">
              {[...audits].reverse().slice(0, 4).map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-[11px]">
                  <span className="text-gray-500 w-16 shrink-0">{a.date}</span>
                  <span className="text-gray-600 flex-1 truncate">{a.auditor.name}</span>
                  <Badge
                    className={`text-[9px] ${
                      (a.overallScore ?? 0) >= 80
                        ? "bg-green-100 text-green-700"
                        : (a.overallScore ?? 0) >= 60
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-red-100 text-red-700"
                    }`}
                  >
                    {a.overallScore ?? 0}%
                  </Badge>
                  <DeltaBadge delta={a.scoreDelta} suffix="%" />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setExpanded({ ...expanded, [template.id]: !isExpanded })}
              className="flex items-center gap-1 text-[11px] font-medium text-gray-600 active:text-terracotta border-t border-gray-100 pt-2 w-full"
            >
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Latest audit per-item breakdown
            </button>

            {isExpanded && latest && (
              <div className="space-y-1">
                {latest.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="text-gray-700 flex-1 truncate">{it.itemTitle}</span>
                    <span className="font-medium text-gray-900 w-8 text-right">{it.rating ?? "—"}</span>
                    <DeltaBadge delta={it.ratingDelta} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
