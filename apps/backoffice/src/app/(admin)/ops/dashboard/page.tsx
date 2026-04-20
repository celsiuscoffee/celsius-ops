"use client";

import Link from "next/link";
import {
  ClipboardCheck, Camera, AlertTriangle, Store, BookOpen, Clock,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type OpsPerformance = {
  summary: {
    totalChecklists: number;
    completedChecklists: number;
    inProgressChecklists: number;
    pendingChecklists: number;
    completionRate: number;
    totalItems: number;
    itemsWithPhotos: number;
    photoRate: number;
  };
  staffBreakdown: { id: string; name: string; role: string; total: number; completed: number; completionRate: number; itemsCompleted: number; photoRate: number }[];
  outletBreakdown: { id: string; name: string; code: string; total: number; completed: number; completionRate: number }[];
  dailyTrend: { date: string; total: number; completed: number }[];
  incomplete: { id: string; sopTitle: string; category: string; outlet: string; assignedTo: string; date: string; shift: string | null; itemsCompleted: number; totalItems: number }[];
};

function rangeQs(days: number): string {
  const to = new Date().toISOString().split("T")[0];
  const from = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  return `from=${from}&to=${to}`;
}

function Tile({ href, icon: Icon, label, value, accent, sub }: {
  href: string;
  icon: React.ElementType;
  label: string;
  value: string | null;
  accent: string;
  sub?: string;
}) {
  return (
    <Link href={href} className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`h-3.5 w-3.5 ${accent}`} />
        <span className="text-[10px] text-gray-500">{label}</span>
      </div>
      {value !== null
        ? <p className="text-2xl font-bold text-gray-900">{value}</p>
        : <div className="h-8 w-16 bg-gray-200 rounded animate-pulse mt-0.5" />}
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </Link>
  );
}

export default function OpsDashboardPage() {
  const { data: weekly } = useFetch<OpsPerformance>(`/api/ops/performance?${rangeQs(7)}`);
  const { data: today } = useFetch<OpsPerformance>(`/api/ops/performance?${rangeQs(1)}`);

  const completionAccent = (rate: number) =>
    rate >= 80 ? "text-green-600" : rate >= 50 ? "text-amber-600" : "text-red-600";

  return (
    <div className="p-4 sm:p-6 lg:p-8 overflow-x-hidden">
      <div className="mb-6">
        <h1 className="font-heading text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-terracotta" /> Ops
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Checklist completion, photo compliance, and outlet performance.</p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Tile
          href="/ops/audit"
          icon={ClipboardCheck}
          accent="text-terracotta"
          label="Today Completion"
          value={today ? `${today.summary.completionRate}%` : null}
          sub={today ? `${today.summary.completedChecklists}/${today.summary.totalChecklists}` : undefined}
        />
        <Tile
          href="/ops/audit"
          icon={ClipboardCheck}
          accent={weekly ? completionAccent(weekly.summary.completionRate) : "text-gray-400"}
          label="7-day Completion"
          value={weekly ? `${weekly.summary.completionRate}%` : null}
          sub={weekly ? `${weekly.summary.completedChecklists}/${weekly.summary.totalChecklists}` : undefined}
        />
        <Tile
          href="/ops/audit"
          icon={Camera}
          accent="text-blue-500"
          label="Photo Rate"
          value={weekly ? `${weekly.summary.photoRate}%` : null}
          sub={weekly ? `${weekly.summary.itemsWithPhotos}/${weekly.summary.totalItems}` : undefined}
        />
        <Tile
          href="/ops/audit"
          icon={Clock}
          accent="text-amber-500"
          label="In Progress"
          value={weekly ? String(weekly.summary.inProgressChecklists) : null}
        />
        <Tile
          href="/ops/audit"
          icon={AlertTriangle}
          accent={weekly && weekly.summary.pendingChecklists > 0 ? "text-red-500" : "text-gray-400"}
          label="Pending"
          value={weekly ? String(weekly.summary.pendingChecklists) : null}
        />
        <Tile
          href="/ops/sops"
          icon={BookOpen}
          accent="text-emerald-500"
          label="Total Checks (7d)"
          value={weekly ? String(weekly.summary.totalChecklists) : null}
        />
      </div>

      {/* Detail */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Outlet leaderboard */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Store className="h-4 w-4 text-terracotta" /> Outlets (7 days)
            </h2>
            <Link href="/ops/audit" className="text-xs text-terracotta hover:underline">All →</Link>
          </div>
          {!weekly ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : weekly.outletBreakdown.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">No checklists in the last 7 days</p>
          ) : (
            weekly.outletBreakdown.map((o) => (
              <div key={o.id} className="flex items-center gap-2 py-2">
                <span className="text-xs text-gray-700 w-32 truncate">{o.name}</span>
                <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      o.completionRate >= 80 ? "bg-green-500" :
                      o.completionRate >= 50 ? "bg-amber-400" : "bg-red-400"
                    }`}
                    style={{ width: `${Math.min(o.completionRate, 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-500 w-14 text-right">{o.completed}/{o.total}</span>
                <span className={`text-[10px] font-bold w-10 text-right ${completionAccent(o.completionRate)}`}>
                  {o.completionRate}%
                </span>
              </div>
            ))
          )}
        </div>

        {/* Incomplete checklists */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Incomplete
            </h2>
            <Link href="/ops/audit" className="text-xs text-terracotta hover:underline">Audit →</Link>
          </div>
          {!weekly ? (
            <div className="space-y-2">
              {[1,2,3,4].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : weekly.incomplete.length === 0 ? (
            <p className="text-xs text-green-600 py-6 text-center font-medium">All caught up — nothing incomplete</p>
          ) : (
            weekly.incomplete.slice(0, 6).map((c) => (
              <div key={c.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-700 truncate">{c.sopTitle}</p>
                  <p className="text-[10px] text-gray-400 truncate">
                    {c.outlet} · {c.assignedTo} · {new Date(c.date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}
                  </p>
                </div>
                <span className="text-[10px] text-gray-500 shrink-0 ml-2">
                  {c.itemsCompleted}/{c.totalItems}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Top performers */}
      {weekly && weekly.staffBreakdown.length > 0 && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Top Performers (7 days)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {weekly.staffBreakdown.slice(0, 6).map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">{s.name}</p>
                  <p className="text-[10px] text-gray-400">{s.role.toLowerCase()} · {s.itemsCompleted} items</p>
                </div>
                <span className={`text-xs font-bold ${completionAccent(s.completionRate)}`}>
                  {s.completionRate}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
