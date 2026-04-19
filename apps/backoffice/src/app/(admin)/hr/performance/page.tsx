"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState, useMemo } from "react";
import Link from "next/link";
import { TrendingUp, Star, Clock, CalendarOff, ClipboardCheck, MessageSquare, AlertTriangle, Trophy, Loader2, ShieldCheck, ThumbsUp, ThumbsDown } from "lucide-react";

type StaffPerf = {
  userId: string;
  name: string;
  fullName: string | null;
  role: string;
  outletName: string | null;
  position: string | null;
  employment_type: string | null;
  clockIns: number;
  lateCount: number;
  totalLateMinutes: number;
  avgLateMinutes: number;
  scheduledHours: number;
  actualHours: number;
  otHours: number;
  leaveDays: number;
  checklistsAssigned: number;
  checklistsCompleted: number;
  opsCompletionRate: number;
  reviewsOnShift: number;
  avgReviewRating: number;
  auditMentions: number;
  auditPositive: number;
  auditNegative: number;
  score: number;
};

type AuditMention = {
  reportId: string;
  outletName: string;
  date: string;
  auditor: string;
  overallScore: number | null;
  sentiment: "positive" | "negative" | "neutral";
  excerpt: string;
  staffMentioned: { userId: string; name: string }[];
};

type ReviewWithContext = {
  id: string;
  outletId: string;
  outletName: string;
  rating: number;
  comment?: string;
  reviewer: string;
  createdAt: string;
  staffOnShift: { userId: string; name: string }[];
};

type Outlet = { id: string; name: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function HRPerformancePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [outletId, setOutletId] = useState<string>("");

  const qs = new URLSearchParams();
  qs.set("year", String(year));
  qs.set("month", String(month));
  if (outletId) qs.set("outletId", outletId);
  const { data, isLoading } = useFetch<{ staff: StaffPerf[]; reviews: ReviewWithContext[]; auditMentions: AuditMention[] }>(`/api/hr/performance?${qs}`);
  const { data: outletsData } = useFetch<Outlet[]>("/api/settings/outlets");

  const staff = data?.staff || [];
  const reviews = data?.reviews || [];
  const auditMentions = data?.auditMentions || [];
  const outlets = outletsData || [];

  const scoreColor = (score: number) => {
    if (score >= 80) return "text-green-700 bg-green-50";
    if (score >= 60) return "text-amber-700 bg-amber-50";
    return "text-red-700 bg-red-50";
  };

  const stars = (rating: number) => "★".repeat(Math.round(rating)) + "☆".repeat(5 - Math.round(rating));

  const summary = useMemo(() => {
    if (staff.length === 0) return null;
    const avgScore = Math.round(staff.reduce((s, p) => s + p.score, 0) / staff.length);
    const avgPunctuality = Math.round(staff.reduce((s, p) => s + p.avgLateMinutes, 0) / staff.length * 10) / 10;
    const totalReviews = reviews.length;
    const avgRating = reviews.length > 0 ? Math.round(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length * 10) / 10 : 0;
    return { avgScore, avgPunctuality, totalReviews, avgRating };
  }, [staff, reviews]);

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-terracotta" /> Staff Performance
        </h1>
        <p className="text-sm text-muted-foreground">Attendance, hours, leave, ops compliance & customer feedback — composite monthly score per staff</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-xl border bg-card p-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Period</span>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded border bg-background px-3 py-1.5 text-sm">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded border bg-background px-3 py-1.5 text-sm">
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Outlet</span>
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="rounded border bg-background px-3 py-1.5 text-sm">
            <option value="">All outlets</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Trophy className="h-4 w-4" /> Team score</div>
            <div className="text-2xl font-bold">{summary.avgScore}</div>
            <div className="text-xs text-gray-500">avg across {staff.length} staff</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Clock className="h-4 w-4" /> Avg late</div>
            <div className="text-2xl font-bold">{summary.avgPunctuality}m</div>
            <div className="text-xs text-gray-500">per clock-in</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Star className="h-4 w-4" /> Customer rating</div>
            <div className="text-2xl font-bold">{summary.avgRating > 0 ? summary.avgRating.toFixed(1) : "—"}</div>
            <div className="text-xs text-gray-500">{summary.totalReviews} Google reviews this period</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><ClipboardCheck className="h-4 w-4" /> Ops compliance</div>
            <div className="text-2xl font-bold">{Math.round(staff.reduce((s, p) => s + p.opsCompletionRate, 0) / Math.max(1, staff.filter(p => p.checklistsAssigned > 0).length)) || 0}%</div>
            <div className="text-xs text-gray-500">avg checklist completion</div>
          </div>
        </div>
      )}

      {/* Staff table */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="font-semibold">Staff Scores — {MONTHS[month - 1]} {year}</h2>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-terracotta" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-xs text-gray-500">
                <th className="px-3 py-2 text-left">Staff</th>
                <th className="px-3 py-2 text-center" title="Composite score 0-100. See formula at bottom of page.">Score</th>
                <th className="px-3 py-2 text-center" title="Number of attendance records this period">Clock-ins</th>
                <th className="px-3 py-2 text-center" title="Average minutes late per clock-in">Late (avg)</th>
                <th className="px-3 py-2 text-center" title="Actual clocked hours / scheduled hours">Hours (actual / scheduled)</th>
                <th className="px-3 py-2 text-center" title="Approved overtime hours">OT</th>
                <th className="px-3 py-2 text-center" title="Approved leave days taken">Leave days</th>
                <th className="px-3 py-2 text-center" title="Completed checklists / total assigned this period">Ops %</th>
                <th className="px-3 py-2 text-center" title="Google reviews mentioning this staff member (positive / negative)">Reviews</th>
                <th className="px-3 py-2 text-center" title="Audit reports with this staff mentioned">Audits</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((p) => (
                <tr key={p.userId} className="border-t hover:bg-gray-50/40">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-gray-500">{p.position || p.role} {p.outletName ? `· ${p.outletName}` : ""}</div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={"inline-block rounded px-2 py-0.5 text-xs font-semibold " + scoreColor(p.score)}>
                      {p.score}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">{p.clockIns}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={p.avgLateMinutes > 10 ? "text-red-700" : p.avgLateMinutes > 3 ? "text-amber-700" : ""}>
                      {p.avgLateMinutes > 0 ? `+${p.avgLateMinutes}m` : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {p.actualHours.toFixed(1)}h / {p.scheduledHours.toFixed(1)}h
                  </td>
                  <td className="px-3 py-2.5 text-center">{p.otHours > 0 ? p.otHours.toFixed(1) + "h" : "—"}</td>
                  <td className="px-3 py-2.5 text-center">{p.leaveDays > 0 ? p.leaveDays : "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    {p.checklistsAssigned > 0 ? `${p.opsCompletionRate}%` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {p.reviewsOnShift > 0 ? (
                      <span className="text-amber-600">{p.reviewsOnShift} · {p.avgReviewRating}★</span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {p.auditMentions > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs">
                        {p.auditPositive > 0 && <span className="text-green-700">👍{p.auditPositive}</span>}
                        {p.auditNegative > 0 && <span className="text-red-700">👎{p.auditNegative}</span>}
                        {p.auditMentions - p.auditPositive - p.auditNegative > 0 && (
                          <span className="text-gray-500">·{p.auditMentions - p.auditPositive - p.auditNegative}</span>
                        )}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/hr/employees/${p.userId}`} className="text-xs text-terracotta hover:underline">View</Link>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-sm text-muted-foreground">No data for this period</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reviews panel */}
      {reviews.length > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="border-b p-4">
            <h2 className="flex items-center gap-2 font-semibold"><MessageSquare className="h-5 w-5 text-terracotta" /> Customer Reviews — {MONTHS[month - 1]} {year}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Google Business Profile reviews, cross-referenced with staff on shift at the time of review.</p>
          </div>
          <div className="divide-y">
            {reviews.map((r) => (
              <div key={r.id} className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.reviewer}</span>
                    <span className="text-xs text-gray-400">· {r.outletName}</span>
                    <span className="text-xs text-gray-400">· {new Date(r.createdAt).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}</span>
                  </div>
                  <span className="text-amber-500 font-semibold">{stars(r.rating)}</span>
                </div>
                {r.comment && <p className="mb-2 text-sm text-gray-700">{r.comment}</p>}
                {r.staffOnShift.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-xs text-muted-foreground">Staff on shift:</span>
                    {r.staffOnShift.map((s) => (
                      <span key={s.userId} className="rounded-full bg-terracotta/10 px-2 py-0.5 text-xs text-terracotta">{s.name}</span>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground"><AlertTriangle className="h-3 w-3" /> No staff clocked in at the time</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit mentions panel */}
      {auditMentions.length > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="border-b p-4">
            <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-terracotta" /> Manager Audit Mentions — {MONTHS[month - 1]} {year}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Completed manager audits with staff named in notes. Positive mentions boost score, negative ones reduce it.</p>
          </div>
          <div className="divide-y">
            {auditMentions.map((a) => (
              <div key={a.reportId} className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{a.outletName}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">{new Date(a.date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">by {a.auditor}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.overallScore !== null && (
                      <span className="text-xs text-gray-500">Score: {Number(a.overallScore).toFixed(0)}</span>
                    )}
                    {a.sentiment === "positive" && <span className="flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs text-green-700"><ThumbsUp className="h-3 w-3" /> Positive</span>}
                    {a.sentiment === "negative" && <span className="flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700"><ThumbsDown className="h-3 w-3" /> Negative</span>}
                    {a.sentiment === "neutral" && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Neutral</span>}
                  </div>
                </div>
                {a.excerpt && <p className="mb-2 text-sm text-gray-700">{a.excerpt}{a.excerpt.length >= 300 ? "…" : ""}</p>}
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs text-muted-foreground">Mentioned:</span>
                  {a.staffMentioned.map((s) => (
                    <span key={s.userId} className={
                      "rounded-full px-2 py-0.5 text-xs " +
                      (a.sentiment === "positive" ? "bg-green-100 text-green-800" :
                       a.sentiment === "negative" ? "bg-red-100 text-red-800" :
                       "bg-gray-100 text-gray-700")
                    }>{s.name}</span>
                  ))}
                  <Link href={`/ops/audit-reports/${a.reportId}`} className="ml-2 text-xs text-terracotta hover:underline">View full report →</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
        <strong>Score formula:</strong> 30% punctuality (100 − avgLateMinutes × 5) · 20% hours efficiency (actual / scheduled) · 20% ops compliance (checklists completed) · 20% review rating (rating × 20, neutral 60 if no reviews) · 10% base · ±15 audit adjustment (+5/positive mention, −10/negative).
      </p>
    </div>
  );
}
