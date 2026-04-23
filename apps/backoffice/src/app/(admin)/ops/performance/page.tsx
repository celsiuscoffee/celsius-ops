"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardCheck, CheckCircle2, Clock, AlertCircle, Camera,
  Loader2, Users, Building2, TrendingUp, ChevronRight,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Outlet = { id: string; code: string; name: string };

type PerformanceData = {
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
  staffBreakdown: {
    id: string; name: string; role: string;
    total: number; completed: number; completionRate: number;
    items: number; completedItems: number; itemsCompleted: number;
    photos: number; photoRate: number;
    checklistsClaimed: number; checklistsCompleted: number;
  }[];
  outletBreakdown: {
    id: string; name: string; code: string;
    total: number; completed: number; completionRate: number;
  }[];
  dailyTrend: { date: string; total: number; completed: number }[];
  incomplete: {
    id: string; sopTitle: string; category: string; outlet: string;
    assignedTo: string; date: string; shift: string;
    itemsCompleted: number; totalItems: number;
  }[];
};

export default function OpsPerformancePage() {
  const { data: outlets } = useFetch<Outlet[]>("/api/settings/outlets");
  const [outletId, setOutletId] = useState("");
  const [from, setFrom] = useState(() => {
    const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return d.toISOString().split("T")[0];
  });
  const [to, setTo] = useState(() => new Date().toISOString().split("T")[0]);

  let apiUrl = `/api/ops/performance?from=${from}&to=${to}`;
  if (outletId) apiUrl += `&outletId=${outletId}`;

  const { data, isLoading } = useFetch<PerformanceData>(apiUrl);

  const stats = data ? [
    { label: "Total Checklists", value: data.summary.totalChecklists, icon: ClipboardCheck, color: "text-terracotta", bg: "bg-terracotta/10" },
    { label: "Completed", value: data.summary.completedChecklists, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-100" },
    { label: "Completion Rate", value: `${data.summary.completionRate}%`, icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-100" },
    { label: "Photo Compliance", value: `${data.summary.photoRate}%`, icon: Camera, color: "text-purple-600", bg: "bg-purple-100" },
  ] : [];

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Ops Performance</h2>
        <p className="mt-0.5 text-sm text-gray-500">Monitor staff checklist completion and compliance</p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={outletId}
          onChange={(e) => setOutletId(e.target.value)}
          className="rounded-md border border-gray-200 px-3 py-2 text-sm"
        >
          <option value="">All Outlets</option>
          {outlets?.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
          <span className="text-sm text-gray-400">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      ) : !data ? (
        <p className="text-sm text-gray-500">No data available</p>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
            {stats.map((stat) => (
              <Card key={stat.label}>
                <CardContent className="flex items-center gap-4 p-5">
                  <div className={`rounded-lg p-2.5 ${stat.bg}`}>
                    <stat.icon className={`h-5 w-5 ${stat.color}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                    <p className="text-xs text-gray-500">{stat.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Needs Attention — shown first */}
          {data.incomplete.length > 0 && (
            <Card className="mb-8 border-yellow-200">
              <CardContent className="p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />Needs Attention
                  <Badge variant="outline" className="text-[10px] text-yellow-600 border-yellow-300 ml-auto">
                    {data.incomplete.length}
                  </Badge>
                </h3>
                <div className="space-y-2">
                  {data.incomplete.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-lg border border-yellow-100 bg-yellow-50/30 p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{item.sopTitle}</p>
                        <p className="text-[10px] text-gray-400">
                          {item.outlet} · {item.assignedTo} · {item.shift}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] text-yellow-600 border-yellow-300 shrink-0">
                        {item.itemsCompleted}/{item.totalItems}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Daily Trend */}
          {data.dailyTrend.length > 0 && (
            <Card className="mb-8">
              <CardContent className="p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Daily Completion</h3>
                <div className="flex items-end gap-1 h-32">
                  {data.dailyTrend.map((d) => {
                    const rate = d.total > 0 ? (d.completed / d.total) * 100 : 0;
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-[9px] text-gray-400">{Math.round(rate)}%</span>
                        <div className="w-full bg-gray-100 rounded-t relative" style={{ height: "80px" }}>
                          <div
                            className="absolute bottom-0 w-full bg-terracotta rounded-t transition-all"
                            style={{ height: `${rate}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-gray-400">
                          {new Date(d.date).toLocaleDateString("en", { weekday: "short" })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2 mb-8">
            {/* Staff Leaderboard */}
            <Card>
              <CardContent className="p-5">
                {data.staffBreakdown.length === 0 ? (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <Users className="h-4 w-4 text-gray-400" />Staff Performance
                      </h3>
                    </div>
                    <p className="text-sm text-gray-400 text-center py-4">No staff data</p>
                  </div>
                ) : (
                  <>
                    {/* Top 3 */}
                    <div className="mb-4">
                      <h3 className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        🏆 Top Performers
                      </h3>
                      <div className="space-y-1.5">
                        {data.staffBreakdown.slice(0, 3).map((s, i) => (
                          <Link key={s.id} href={`/ops/performance/staff/${s.id}`}>
                            <div className="flex items-center gap-3 rounded-lg border border-green-100 bg-green-50/50 p-3 hover:bg-green-50 transition-colors cursor-pointer">
                              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                                i === 0 ? "bg-yellow-400 text-white" : i === 1 ? "bg-gray-300 text-white" : "bg-amber-600 text-white"
                              }`}>
                                {i + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                                <p className="text-[10px] text-gray-400">{s.role}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-lg font-bold text-green-600">{s.itemsCompleted}</p>
                                <p className="text-[10px] text-gray-400">tasks done</p>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>

                    {/* Bottom 3 */}
                    {data.staffBreakdown.length > 3 && (
                      <div>
                        <h3 className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          ⚠️ Needs Improvement
                        </h3>
                        <div className="space-y-1.5">
                          {data.staffBreakdown.slice(-3).reverse().map((s) => (
                            <Link key={s.id} href={`/ops/performance/staff/${s.id}`}>
                              <div className="flex items-center gap-3 rounded-lg border border-red-100 bg-red-50/50 p-3 hover:bg-red-50 transition-colors cursor-pointer">
                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-500">
                                  {s.name.charAt(0)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                                  <p className="text-[10px] text-gray-400">{s.role}</p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-lg font-bold text-red-500">{s.itemsCompleted}</p>
                                  <p className="text-[10px] text-gray-400">tasks done</p>
                                </div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Outlet Breakdown */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-gray-400" />Outlet Compliance
                  </h3>
                </div>
                {data.outletBreakdown.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No outlet data</p>
                ) : (
                  <div className="space-y-2">
                    {data.outletBreakdown.map((o) => (
                      <div key={o.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{o.name}</p>
                          <p className="text-[10px] text-gray-400">{o.completed}/{o.total} completed</p>
                        </div>
                        <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${o.completionRate >= 80 ? "bg-green-500" : o.completionRate >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                            style={{ width: `${o.completionRate}%` }}
                          />
                        </div>
                        <span className={`text-sm font-bold w-12 text-right ${o.completionRate >= 80 ? "text-green-600" : o.completionRate >= 50 ? "text-yellow-600" : "text-red-500"}`}>
                          {o.completionRate}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

        </>
      )}
    </div>
  );
}
