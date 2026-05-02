"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import Link from "next/link";
import { Wallet, Loader2, TrendingUp, AlertTriangle, Trophy } from "lucide-react";
import { HrPageHeader } from "@/components/hr/page-header";
import { AllowanceTabs } from "@/components/hr/allowance-tabs";

type StaffSummary = {
  userId: string;
  name: string;
  fullName: string | null;
  outletName: string | null;
  attendanceEarned: number;
  attendanceBase: number;
  performanceEarned: number;
  performanceBase: number;
  performanceScore: number;
  totalEarned: number;
  totalMax: number;
  lateCount: number;
  absentCount: number;
};

type Rules = {
  attendance_allowance_amount: number;
  performance_allowance_amount: number;
  performance_allowance_mode: string;
};

type Outlet = { id: string; name: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function AllowancesPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [outletId, setOutletId] = useState("");

  const qs = new URLSearchParams({ year: String(year), month: String(month) });
  if (outletId) qs.set("outletId", outletId);
  const { data, isLoading } = useFetch<{ staff: StaffSummary[]; rules: Rules }>(`/api/hr/allowances?${qs}`);
  const { data: outletsData } = useFetch<Outlet[]>("/api/settings/outlets");

  const staff = data?.staff || [];
  const rules = data?.rules;
  const outlets = outletsData || [];

  const totalPayout = staff.reduce((s, p) => s + p.totalEarned, 0);
  const maxPayout = staff.reduce((s, p) => s + p.totalMax, 0);
  const fullEarners = staff.filter(p => p.totalEarned === p.totalMax).length;
  const atRisk = staff.filter(p => p.absentCount > 0 || p.lateCount > 2).length;

  const barColor = (earned: number, base: number) => {
    const pct = base > 0 ? earned / base : 0;
    if (pct >= 0.9) return "bg-green-500";
    if (pct >= 0.6) return "bg-amber-500";
    return "bg-red-500";
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <HrPageHeader
        title="Allowances"
        icon={<Wallet className="h-6 w-6 text-terracotta" />}
        description="Live attendance & performance allowances this month. Paid with the next salary cycle."
      />
      <AllowanceTabs />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
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
        {rules && (
          <span className="ml-auto text-xs text-muted-foreground">
            RM {rules.attendance_allowance_amount} attendance + RM {rules.performance_allowance_amount} performance ({rules.performance_allowance_mode})
            <Link href="/hr/settings/working-time" className="ml-2 text-terracotta hover:underline">Configure →</Link>
          </span>
        )}
      </div>

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Wallet className="h-4 w-4" /> Total payout</div>
          <div className="text-2xl font-bold">RM {totalPayout.toFixed(0)}</div>
          <div className="text-xs text-gray-500">of max RM {maxPayout.toFixed(0)}</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Trophy className="h-4 w-4" /> Full earners</div>
          <div className="text-2xl font-bold">{fullEarners}</div>
          <div className="text-xs text-gray-500">of {staff.length} staff</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-4 w-4" /> At risk</div>
          <div className="text-2xl font-bold text-amber-700">{atRisk}</div>
          <div className="text-xs text-gray-500">≥1 absence or &gt;2 lates</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="h-4 w-4" /> Avg earned</div>
          <div className="text-2xl font-bold">RM {staff.length > 0 ? (totalPayout / staff.length).toFixed(0) : 0}</div>
          <div className="text-xs text-gray-500">per staff this month</div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="font-semibold">Per Staff — {MONTHS[month - 1]} {year}</h2>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-terracotta" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-xs text-gray-500">
                <th className="px-3 py-2 text-left">Staff</th>
                <th className="px-3 py-2 text-left">Attendance</th>
                <th className="px-3 py-2 text-left">Performance</th>
                <th className="px-3 py-2 text-right">Total earned</th>
                <th className="px-3 py-2 text-center">Lates</th>
                <th className="px-3 py-2 text-center">Absences</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((p) => (
                <tr key={p.userId} className="border-t hover:bg-gray-50/40">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-gray-500">{p.outletName || "—"}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="mb-0.5 flex items-center gap-2">
                      <span className="text-xs font-mono">RM {p.attendanceEarned}</span>
                      <span className="text-xs text-gray-400">/ {p.attendanceBase}</span>
                    </div>
                    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-gray-100">
                      <div className={"h-full " + barColor(p.attendanceEarned, p.attendanceBase)} style={{ width: `${(p.attendanceEarned / p.attendanceBase) * 100}%` }} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="mb-0.5 flex items-center gap-2">
                      <span className="text-xs font-mono">RM {p.performanceEarned}</span>
                      <span className="text-xs text-gray-400">/ {p.performanceBase}</span>
                      <span className="text-xs text-gray-500">· {p.performanceScore}</span>
                    </div>
                    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-gray-100">
                      <div className={"h-full " + barColor(p.performanceEarned, p.performanceBase)} style={{ width: `${(p.performanceEarned / p.performanceBase) * 100}%` }} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-bold text-terracotta">RM {p.totalEarned}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={p.lateCount > 2 ? "text-red-700" : p.lateCount > 0 ? "text-amber-700" : "text-gray-400"}>{p.lateCount || "—"}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={p.absentCount > 0 ? "text-red-700 font-semibold" : "text-gray-400"}>{p.absentCount || "—"}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/hr/employees/${p.userId}`} className="text-xs text-terracotta hover:underline">View</Link>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && !isLoading && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">No staff for this period</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
