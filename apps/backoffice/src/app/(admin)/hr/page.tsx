"use client";

import { useFetch } from "@/lib/use-fetch";
import { Clock, CalendarOff, CalendarDays, Banknote, Bot, Loader2, BarChart3, Cake, PartyPopper, Users, TrendingUp, Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

// Module hub cards — mirror the sidebar IA ((admin)/layout.tsx HR section) and
// the in-module tab strips (components/hr/module-tabs.tsx) so all three
// surfaces present the same BrioHR-style structure.
const MODULES = [
  {
    label: "People",
    description: "Profiles, documents, certifications",
    href: "/hr/employees",
    icon: Users,
    color: "text-terracotta bg-orange-50",
    links: [
      { label: "Employees", href: "/hr/employees" },
      { label: "Certifications", href: "/hr/certifications" },
      { label: "Memos", href: "/hr/memos" },
    ],
  },
  {
    label: "Leave",
    description: "Requests, balances, policies",
    href: "/hr/leave",
    icon: CalendarOff,
    color: "text-amber-600 bg-amber-50",
    links: [
      { label: "Requests", href: "/hr/leave" },
      { label: "Balances", href: "/hr/settings" },
      { label: "Policies", href: "/hr/settings/leave-policies" },
      { label: "Holidays", href: "/hr/settings/public-holidays" },
    ],
  },
  {
    label: "Time & Attendance",
    description: "Clock-ins, overtime, swaps",
    href: "/hr/attendance",
    icon: Clock,
    color: "text-blue-600 bg-blue-50",
    links: [
      { label: "Attendance", href: "/hr/attendance" },
      { label: "Overtime", href: "/hr/overtime" },
      { label: "Shift Swaps", href: "/hr/shift-swaps" },
    ],
  },
  {
    label: "Scheduling",
    description: "Rosters, availability, coverage",
    href: "/hr/schedules",
    icon: CalendarDays,
    color: "text-indigo-600 bg-indigo-50",
    links: [
      { label: "Schedules", href: "/hr/schedules" },
      { label: "Availability", href: "/hr/availability" },
      { label: "Coverage", href: "/hr/coverage" },
    ],
  },
  {
    label: "Payroll",
    description: "Runs, allowances, statutory",
    href: "/hr/payroll",
    icon: Banknote,
    color: "text-green-600 bg-green-50",
    links: [
      { label: "Monthly", href: "/hr/payroll" },
      { label: "Weekly", href: "/hr/payroll/weekly" },
      { label: "Allowances", href: "/hr/allowances" },
      { label: "Statutory Calendar", href: "/hr/compliance" },
    ],
  },
  {
    label: "Performance",
    description: "Scores, review penalties",
    href: "/hr/performance",
    icon: TrendingUp,
    color: "text-purple-600 bg-purple-50",
    links: [
      { label: "Performance", href: "/hr/performance" },
      { label: "Review Penalties", href: "/hr/review-penalties" },
    ],
  },
  {
    label: "Reports",
    description: "Headcount, turnover, payroll trend",
    href: "/hr/analytics",
    icon: BarChart3,
    color: "text-cyan-700 bg-cyan-50",
    links: [{ label: "Analytics", href: "/hr/analytics" }],
  },
  {
    label: "Settings",
    description: "Policies, holidays, company",
    href: "/hr/settings",
    icon: Settings,
    color: "text-gray-600 bg-gray-100",
    links: [
      { label: "Time Off", href: "/hr/settings" },
      { label: "Shift Templates", href: "/hr/settings/shift-templates" },
      { label: "Working Time", href: "/hr/settings/working-time" },
      { label: "Company", href: "/hr/settings/company" },
    ],
  },
];

type DashboardData = {
  flaggedAttendance: number;
  escalatedLeave: number;
  scheduleStatus: string;
  payrollStatus: string;
  lastAgentRun: {
    status: string;
    completed_at: string;
    items_processed: number;
    items_flagged: number;
    items_auto_approved: number;
  } | null;
};

export default function HRDashboardPage() {
  const { data, mutate } = useFetch<DashboardData>("/api/hr/dashboard");
  const [processing, setProcessing] = useState(false);

  const runProcessor = async () => {
    setProcessing(true);
    try {
      await fetch("/api/hr/attendance/process", { method: "POST" });
      mutate();
    } finally {
      setProcessing(false);
    }
  };

  const cards = [
    {
      label: "Attendance Flags",
      value: data?.flaggedAttendance ?? "—",
      icon: Clock,
      href: "/hr/attendance",
      color: (data?.flaggedAttendance ?? 0) > 0 ? "text-red-600 bg-red-50" : "text-green-600 bg-green-50",
      subtitle: (data?.flaggedAttendance ?? 0) > 0 ? "Need review" : "All clear",
    },
    {
      label: "Leave Escalated",
      value: data?.escalatedLeave ?? "—",
      icon: CalendarOff,
      href: "/hr/leave",
      color: (data?.escalatedLeave ?? 0) > 0 ? "text-amber-600 bg-amber-50" : "text-green-600 bg-green-50",
      subtitle: (data?.escalatedLeave ?? 0) > 0 ? "AI needs your input" : "All clear",
    },
    {
      label: "Schedule",
      value: data?.scheduleStatus === "published" ? "Published" : data?.scheduleStatus === "ai_generated" ? "Ready" : "—",
      icon: CalendarDays,
      href: "/hr/schedules",
      color: data?.scheduleStatus === "published" ? "text-green-600 bg-green-50" : "text-blue-600 bg-blue-50",
      subtitle: data?.scheduleStatus === "published" ? "This week" : "Not generated",
    },
    {
      label: "Payroll",
      value: data?.payrollStatus === "confirmed" ? "Confirmed" : data?.payrollStatus === "ai_computed" ? "Ready" : "—",
      icon: Banknote,
      href: "/hr/payroll",
      color: data?.payrollStatus === "confirmed" ? "text-green-600 bg-green-50" : "text-gray-600 bg-gray-50",
      subtitle: data?.payrollStatus === "not_started" ? "Not started" : data?.payrollStatus || "",
    },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">HR Dashboard</h1>
          <p className="text-sm text-muted-foreground">AI-managed, human-reviewed</p>
        </div>
        <button
          onClick={runProcessor}
          disabled={processing}
          className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
        >
          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          Run Attendance AI
        </button>
      </div>

      {/* Status Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href}
              className="rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div className={`rounded-lg p-2 ${card.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-3xl font-bold">{card.value}</span>
              </div>
              <p className="mt-3 font-medium">{card.label}</p>
              <p className="text-sm text-muted-foreground">{card.subtitle}</p>
            </Link>
          );
        })}
      </div>

      {/* Module hub — BrioHR-style: one card per module, sub-pages as inline
          links (same groups as the sidebar + in-module tab strips). */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {MODULES.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="rounded-xl border bg-card p-4 shadow-sm transition hover:shadow-md">
              <Link href={m.href} className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${m.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{m.description}</p>
                </div>
              </Link>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-2.5">
                {m.links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground transition hover:border-terracotta hover:text-terracotta"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Celebrations widget — birthdays + anniversaries */}
      <CelebrationsWidget />

      {/* Last AI Run Info */}
      {data?.lastAgentRun && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <Bot className="h-5 w-5 text-terracotta" />
            Last Attendance AI Run
          </h3>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">When</p>
              <p className="font-medium">
                {data.lastAgentRun.completed_at
                  ? new Date(data.lastAgentRun.completed_at).toLocaleString("en-MY")
                  : "Running..."}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Processed</p>
              <p className="font-medium">{data.lastAgentRun.items_processed}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Auto-approved</p>
              <p className="font-medium text-green-600">{data.lastAgentRun.items_auto_approved}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Flagged</p>
              <p className="font-medium text-red-600">{data.lastAgentRun.items_flagged}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type Celebration = {
  user_id: string;
  name: string;
  outlet: string | null;
  type: "birthday" | "anniversary";
  on: string;
  days_until: number;
  years?: number;
};

function CelebrationsWidget() {
  const { data } = useFetch<{ today: Celebration[]; upcoming: Celebration[] }>("/api/hr/celebrations?days=14");
  const today = data?.today || [];
  const upcoming = (data?.upcoming || []).slice(0, 8);
  if (today.length === 0 && upcoming.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card p-5">
      <h3 className="mb-3 flex items-center gap-2 font-semibold">
        <PartyPopper className="h-5 w-5 text-pink-500" />
        Celebrations
      </h3>
      {today.length > 0 && (
        <div className="mb-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-pink-700">Today</p>
          <div className="flex flex-wrap gap-2">
            {today.map((c) => (
              <Link
                key={`${c.user_id}-${c.type}`}
                href={`/hr/employees/${c.user_id}`}
                className="flex items-center gap-2 rounded-full border border-pink-200 bg-pink-50 px-3 py-1.5 text-xs hover:bg-pink-100"
              >
                {c.type === "birthday" ? <Cake className="h-3 w-3 text-pink-600" /> : <PartyPopper className="h-3 w-3 text-amber-600" />}
                <span className="font-semibold">{c.name}</span>
                {c.type === "anniversary" && c.years && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">{c.years}y</span>
                )}
                {c.outlet && <span className="text-[10px] text-gray-500">· {c.outlet}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}
      {upcoming.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Next 14 days</p>
          <ul className="space-y-1 text-xs">
            {upcoming.map((c) => (
              <li key={`${c.user_id}-${c.type}-${c.on}`} className="flex items-center gap-2">
                {c.type === "birthday" ? <Cake className="h-3 w-3 text-pink-500" /> : <PartyPopper className="h-3 w-3 text-amber-600" />}
                <span className="font-mono text-gray-500 w-16">{c.on}</span>
                <Link href={`/hr/employees/${c.user_id}`} className="font-medium text-blue-600 hover:underline">{c.name}</Link>
                {c.type === "anniversary" && c.years && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">{c.years}y anniversary</span>
                )}
                <span className="text-gray-400">· in {c.days_until} day{c.days_until === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
