"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type CoachInsights = {
  summary: string;
  strengths: string[];
  focus_areas: string[];
  coaching_actions: string[];
  needs_more_data: boolean;
};

type CoachResult = {
  insights: CoachInsights | null;
  generated_at: string | null;
  model: string | null;
  cached: boolean;
  audit_count: number;
  reason?: "no_audits" | "insufficient_data";
};

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
  if (delta === null) return <span className="text-[10px] text-text-3">—</span>;
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-text-2">
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
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-md text-brand-text">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx={lastX} cy={lastY} r="3" fill="currentColor" />
    </svg>
  );
}

export default function StaffSkillsDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { data, isLoading } = useFetch<Response>(`/api/ops/audit-reports/staff/${userId}`);
  const { data: coach, isLoading: coachLoading } = useFetch<CoachResult>(`/api/ops/audit-reports/staff/${userId}/coach`);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-brand-text" />
      </div>
    );
  }

  if (!data?.auditee) {
    return <div className="p-6 text-center text-sm text-text-2">Staff not found</div>;
  }

  const { auditee, templates } = data;

  return (
    <div className="space-y-4 max-w-4xl px-4 pt-6 pb-10 md:px-8">
      <Link href="/ops/staff-skills" className="inline-flex items-center gap-1 text-sm text-text-2 hover:text-text-2">
        <ArrowLeft className="h-4 w-4" />Back to Staff Skills
      </Link>

      <div>
        <h2 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">{auditee.name}</h2>
        <p className="text-sm text-text-2">
          {templates.length} skill template{templates.length !== 1 ? "s" : ""} audited
        </p>
      </div>

      {/* AI Coach card — surfaces strengths, focus areas, and concrete coaching
          actions. Cached server-side per latest audit so this card is cheap. */}
      {(coachLoading || coach?.insights) && (
        <Card className="border-ink/30 bg-gradient-to-br from-amber-50 to-orange-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="rounded-full bg-brand-soft p-1.5">
                <Sparkles className="h-4 w-4 text-brand-text" />
              </div>
              <h3 className="text-sm font-semibold text-text">Coach insights</h3>
              {coach?.cached && (
                <span className="text-[10px] text-text-3">(cached)</span>
              )}
            </div>

            {coachLoading && (
              <div className="flex items-center gap-2 text-xs text-text-2 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analysing audit history…
              </div>
            )}

            {coach?.insights && (
              <div className="space-y-3">
                <p className="text-sm text-text">{coach.insights.summary}</p>

                {coach.insights.needs_more_data ? null : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {coach.insights.strengths.length > 0 && (
                      <div className="rounded-lg bg-surface/70 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-green-700 mb-1.5">Strengths</p>
                        <ul className="space-y-1 text-xs text-text-2">
                          {coach.insights.strengths.map((s, i) => (
                            <li key={i} className="leading-snug">• {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {coach.insights.focus_areas.length > 0 && (
                      <div className="rounded-lg bg-surface/70 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-red-700 mb-1.5">Focus areas</p>
                        <ul className="space-y-1 text-xs text-text-2">
                          {coach.insights.focus_areas.map((s, i) => (
                            <li key={i} className="leading-snug">• {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {coach.insights.coaching_actions.length > 0 && (
                      <div className="rounded-lg bg-surface/70 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-text mb-1.5">This week</p>
                        <ul className="space-y-1 text-xs text-text-2">
                          {coach.insights.coaching_actions.map((s, i) => (
                            <li key={i} className="leading-snug">• {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {templates.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-text-2">No completed audits for this staff member yet.</p>
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
                  <h3 className="text-sm font-semibold text-text">{template.name}</h3>
                  <p className="text-[11px] text-text-2">
                    {audits.length} audit{audits.length !== 1 ? "s" : ""}
                    {(template.jobRoleFilter ?? []).length > 0 ? ` · ${(template.jobRoleFilter ?? []).join(", ")}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-text">
                    {latest?.overallScore ?? 0}<span className="text-sm text-text-3">%</span>
                  </p>
                  {overallChange !== null && audits.length > 1 && (
                    <DeltaBadge delta={overallChange} suffix="% overall" />
                  )}
                </div>
              </div>

              <Sparkline values={audits.map((a) => a.overallScore)} />

              {/* Per-audit row with score + delta */}
              <div className="border-t border-line pt-3 space-y-1.5">
                {[...audits].reverse().map((a) => (
                  <div key={a.id} className="flex items-center gap-3 text-xs">
                    <span className="text-text-2 w-20 shrink-0">{a.date}</span>
                    <span className="text-text-2 flex-1 truncate">
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
                <div className="border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => setExpanded({ ...expanded, [template.id]: !isExpanded })}
                    className="flex items-center gap-1 text-xs font-medium text-text-2 hover:text-brand-text"
                  >
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    Latest audit per-item breakdown
                  </button>

                  {isExpanded && latest && (
                    <div className="mt-2 space-y-1.5">
                      {latest.items.map((it, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          <span className="text-text-3 w-32 shrink-0 truncate">{it.sectionName}</span>
                          <span className="text-text-2 flex-1 truncate">{it.itemTitle}</span>
                          <span className="font-medium text-text w-10 text-right">{it.rating ?? "—"}</span>
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
