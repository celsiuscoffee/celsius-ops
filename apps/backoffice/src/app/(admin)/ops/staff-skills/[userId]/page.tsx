"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

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
    template: { id: string; name: string; jobRoleFilter: string | null };
    audits: AuditEntry[];
  }>;
};

function DeltaBadge({ delta, suffix = "" }: { delta: number | null; suffix?: string }) {
  if (delta === null) return <span className="text-[10px] text-gray-400">—</span>;
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-500">
        <Minus className="h-2.5 w-2.5" />0{suffix}
      </span>
    );
  }
  const positive = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${
        positive ? "text-green-600" : "text-red-600"
      }`}
    >
      {positive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {positive ? "+" : ""}
      {delta}
      {suffix}
    </span>
  );
}

// Inline sparkline so we don't take a chart-library dependency for one widget.
// 100% width, fixed height, plots overall score across audits in chronological
// order so the rightmost point is the most recent.
function Sparkline({ values }: { values: (number | null)[] }) {
  const points = values.filter((v): v is number => v !== null);
  if (points.length < 2) return null;
  const max = 100;
  const min = 0;
  const w = 320;
  const h = 60;
  const stepX = w / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / (max - min)) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = points[points.length - 1];
  const lastX = (points.length - 1) * stepX;
  const lastY = h - ((last - min) / (max - min)) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-md text-terracotta">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx={lastX} cy={lastY} r="3" fill="currentColor" />
    </svg>
  );
}

export default function StaffSkillsDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { data, isLoading } = useFetch<Response>(`/api/ops/audit-reports/staff/${userId}`);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  if (!data?.auditee) {
    return <div className="p-6 text-center text-sm text-gray-500">Staff not found</div>;
  }

  const { auditee, templates } = data;

  return (
    <div className="space-y-4 p-6 max-w-4xl">
      <Link href="/ops/staff-skills" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" />Back to Staff Skills
      </Link>

      <div>
        <h2 className="text-xl font-semibold text-gray-900">{auditee.name}</h2>
        <p className="text-sm text-gray-500">
          {templates.length} skill template{templates.length !== 1 ? "s" : ""} audited
        </p>
      </div>

      {templates.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-gray-500">No completed audits for this staff member yet.</p>
          </CardContent>
        </Card>
      )}

      {templates.map(({ template, audits }) => {
        const latest = audits[audits.length - 1];
        const first = audits[0];
        const overallChange =
          latest?.overallScore !== null && first?.overallScore !== null && first !== latest
            ? Math.round((latest!.overallScore! - first!.overallScore!) * 100) / 100
            : null;
        const isExpanded = expanded[template.id] ?? false;

        return (
          <Card key={template.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{template.name}</h3>
                  <p className="text-[11px] text-gray-500">
                    {audits.length} audit{audits.length !== 1 ? "s" : ""}
                    {template.jobRoleFilter ? ` · ${template.jobRoleFilter}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-gray-900">
                    {latest?.overallScore ?? 0}<span className="text-sm text-gray-400">%</span>
                  </p>
                  {overallChange !== null && audits.length > 1 && (
                    <DeltaBadge delta={overallChange} suffix="% overall" />
                  )}
                </div>
              </div>

              <Sparkline values={audits.map((a) => a.overallScore)} />

              {/* Per-audit row with score + delta */}
              <div className="border-t border-gray-100 pt-3 space-y-1.5">
                {[...audits].reverse().map((a) => (
                  <div key={a.id} className="flex items-center gap-3 text-xs">
                    <span className="text-gray-500 w-20 shrink-0">{a.date}</span>
                    <span className="text-gray-700 flex-1 truncate">
                      {a.auditor.name} · {a.outlet.name}
                    </span>
                    <Badge
                      className={`text-[10px] ${
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

              {/* Per-item drill-down (deltas vs previous audit) */}
              {audits.length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setExpanded({ ...expanded, [template.id]: !isExpanded })}
                    className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-terracotta"
                  >
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    Latest audit per-item breakdown
                  </button>

                  {isExpanded && latest && (
                    <div className="mt-2 space-y-1.5">
                      {latest.items.map((it, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          <span className="text-gray-400 w-32 shrink-0 truncate">{it.sectionName}</span>
                          <span className="text-gray-700 flex-1 truncate">{it.itemTitle}</span>
                          <span className="font-medium text-gray-900 w-10 text-right">{it.rating ?? "—"}</span>
                          <DeltaBadge delta={it.ratingDelta} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
