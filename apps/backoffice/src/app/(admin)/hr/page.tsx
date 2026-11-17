"use client";

import { useFetch } from "@/lib/use-fetch";
import { Clock, CalendarOff, CalendarDays, Banknote, Bot, Loader2, BarChart3, Cake, PartyPopper, Users, TrendingUp, Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { KeyNumber } from "@/components/ui/key-number";

const when12 = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Module hub cards — mirror the sidebar IA ((admin)/layout.tsx HR section) and
// the in-module tab strips (components/hr/module-tabs.tsx) so all three
// surfaces present the same BrioHR-style structure.
const MODULES = [
  {
    label: "People",
    description: "Profiles, documents, certifications",
    href: "/hr/employees",
    icon: Users,
    color: "text-brand-text bg-warn-soft",
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
    color: "text-warn-text bg-warn-soft",
    links: [
      { label: "Requests", href: "/hr/leave" },
      { label: "Balances", href: "/hr/settings" },
      { label: "Policies", href: "/hr/settings/leave-policies" },
      { label: "Holidays", href: "/hr/settings/public-holidays" },
    ],
  },
  {
    label: "Time and attendance",
    description: "Clock-ins, overtime, swaps",
    href: "/hr/attendance",
    icon: Clock,
    color: "text-info-text bg-info-soft",
    links: [
      { label: "Attendance", href: "/hr/attendance" },
      { label: "Overtime", href: "/hr/overtime" },
      { label: "Shift swaps", href: "/hr/shift-swaps" },
    ],
  },
  {
    label: "Scheduling",
    description: "Rosters, availability, coverage",
    href: "/hr/schedules",
    icon: CalendarDays,
    color: "text-info-text bg-info-soft",
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
    color: "text-ok-text bg-ok-soft",
    links: [
      { label: "Monthly", href: "/hr/payroll" },
      { label: "Weekly", href: "/hr/payroll/weekly" },
      { label: "Allowances", href: "/hr/allowances" },
      { label: "Statutory calendar", href: "/hr/compliance" },
    ],
  },
  {
    label: "Performance",
    description: "Scores, review penalties",
    href: "/hr/performance",
    icon: TrendingUp,
    color: "text-info-text bg-info-soft",
    links: [
      { label: "Performance", href: "/hr/performance" },
      { label: "Review penalties", href: "/hr/review-penalties" },
    ],
  },
  {
    label: "Reports",
    description: "Headcount, turnover, payroll trend",
    href: "/hr/analytics",
    icon: BarChart3,
    color: "text-info-text bg-info-soft",
    links: [{ label: "Analytics", href: "/hr/analytics" }],
  },
  {
    label: "Settings",
    description: "Policies, holidays, company",
    href: "/hr/settings",
    icon: Settings,
    color: "text-text-2 bg-sunken",
    links: [
      { label: "Time off", href: "/hr/settings" },
      { label: "Shift templates", href: "/hr/settings/shift-templates" },
      { label: "Working time", href: "/hr/settings/working-time" },
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
  onProbation: number;
};

export default function HRDashboardPage() {
  const { data, mutate } = useFetch<DashboardData>("/api/hr/dashboard");
  // Payroll is Owner/Admin only — hide the Payroll card + stat from managers.
  const { data: me } = useFetch<{ role: string }>("/api/auth/me");
  const canSeePayroll = me?.role === "OWNER" || me?.role === "ADMIN";
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

  const flagged = data?.flaggedAttendance ?? 0;
  const escalated = data?.escalatedLeave ?? 0;
  const probation = data?.onProbation ?? 0;
  const scheduleWord = data?.scheduleStatus === "published" ? "Published" : data?.scheduleStatus === "ai_generated" ? "Drafted" : "Not made";

  return (
    <div className="max-w-[1100px] space-y-5 px-4 pt-6 pb-10 md:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Team overview</h1>
          <p className="mt-0.5 text-sm text-text-2">What needs a decision today, where each part of Team lives, and who is celebrating.</p>
        </div>
        <button
          onClick={runProcessor}
          disabled={processing}
          className="inline-flex h-10 items-center gap-2 self-start rounded-ctl bg-ink px-4 text-sm font-medium text-on-ink hover:bg-ink-hover disabled:opacity-50"
        >
          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          Check clock-ins now
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber href="/hr/attendance" label="Clock-ins flagged" value={data ? String(flagged) : null} tone={flagged > 0 ? "warn" : undefined}
          note={flagged > 0 ? "need a look before payroll" : "all clear"} />
        <KeyNumber href="/hr/leave" label="Leave escalated" value={data ? String(escalated) : null} tone={escalated > 0 ? "warn" : undefined}
          note={escalated > 0 ? "the leave agent needs you" : "all clear"} />
        <KeyNumber href="/hr/schedules" word label="This week's roster" value={data ? scheduleWord : null} tone={data && data.scheduleStatus !== "published" ? "warn" : undefined}
          note={data?.scheduleStatus === "published" ? "staff can see their shifts" : "staff cannot see shifts yet"} />
        <KeyNumber href="/hr/employees?filter=probation" label="On probation" value={data ? String(probation) : null} tone={probation > 0 ? "warn" : undefined}
          note={probation > 0 ? "waiting to be confirmed" : "everyone confirmed"} />
      </div>

      {/* Where each part of Team lives: one list, sub-pages as links. */}
      <section aria-label="Team pages" className="overflow-hidden rounded-card border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-text">Team pages</h2>
        {MODULES.filter((m) => canSeePayroll || m.label !== "Payroll").map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
              <Link href={m.href} className="flex min-w-0 items-center gap-3 sm:w-64 sm:shrink-0">
                <Icon className="h-4 w-4 shrink-0 text-text-3" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">{m.label}</p>
                  <p className="truncate text-[12px] text-text-3">{m.description}</p>
                </div>
              </Link>
              <div className="flex flex-wrap gap-1.5 sm:justify-end sm:flex-1">
                {m.links.map((l) => (
                  <Link key={l.href} href={l.href}
                    className="inline-flex h-8 items-center rounded-full border border-line px-3 text-[12px] text-text-2 transition hover:border-text hover:text-text">
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* Celebrations widget — birthdays + anniversaries */}
      <CelebrationsWidget />

      {data?.lastAgentRun && (
        <section aria-label="Last clock-in check" className="rounded-card border border-line bg-surface px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text"><Bot className="h-4 w-4 text-text-3" />Last clock-in check</h2>
          <p className="mt-1 text-[13px] text-text-2">
            {data.lastAgentRun.completed_at ? when12(data.lastAgentRun.completed_at) : "Running now"}
            {" · "}<span className="font-mono">{data.lastAgentRun.items_processed}</span> checked
            {" · "}<span className="font-mono">{data.lastAgentRun.items_auto_approved}</span> approved on their own
            {" · "}<span className={`font-mono ${data.lastAgentRun.items_flagged ? "text-warn-text" : ""}`}>{data.lastAgentRun.items_flagged}</span> flagged for you
          </p>
        </section>
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
    <section aria-label="Celebrations" className="rounded-card border border-line bg-surface px-4 py-3">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
        <PartyPopper className="h-4 w-4 text-text-3" />
        Birthdays and work anniversaries
      </h2>
      {today.length > 0 && (
        <div className="mb-3">
          <p className="mb-2 text-[12px] font-semibold text-text-2">Today</p>
          <div className="flex flex-wrap gap-2">
            {today.map((c) => (
              <Link
                key={`${c.user_id}-${c.type}`}
                href={`/hr/employees/${c.user_id}`}
                className="flex min-h-9 items-center gap-2 rounded-full bg-brand-soft px-3 py-1.5 text-xs text-text hover:opacity-90"
              >
                {c.type === "birthday" ? <Cake className="h-3 w-3 text-danger-text" /> : <PartyPopper className="h-3 w-3 text-warn-text" />}
                <span className="font-semibold">{c.name}</span>
                {c.type === "anniversary" && c.years && (
                  <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[9px] font-bold text-warn-text">{c.years}y</span>
                )}
                {c.outlet && <span className="text-[10px] text-text-2">· {c.outlet}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}
      {upcoming.length > 0 && (
        <div>
          <p className="mb-2 text-[12px] font-semibold text-text-2">Next 14 days</p>
          <ul className="space-y-1.5 text-[13px]">
            {upcoming.map((c) => (
              <li key={`${c.user_id}-${c.type}-${c.on}`} className="flex items-center gap-2">
                {c.type === "birthday" ? <Cake className="h-3 w-3 text-danger-text" /> : <PartyPopper className="h-3 w-3 text-warn-text" />}
                <span className="w-16 shrink-0 font-mono text-text-2">{c.on}</span>
                <Link href={`/hr/employees/${c.user_id}`} className="font-medium text-text hover:underline">{c.name}</Link>
                {c.type === "anniversary" && c.years && (
                  <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[9px] font-bold text-warn-text">{c.years} years</span>
                )}
                <span className="text-text-3">· in {c.days_until} day{c.days_until === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
