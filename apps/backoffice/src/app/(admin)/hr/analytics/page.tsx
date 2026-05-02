"use client";

import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Users, TrendingDown, Clock, Banknote, AlertTriangle, ShieldAlert, Briefcase } from "lucide-react";
import { HrPageHeader } from "@/components/hr/page-header";

type Analytics = {
  headcount: { active: number; by_type: Record<string, number>; in_probation: number };
  turnover: { ytd_resigners: number; ytd_pct: number };
  attendance_90d: {
    log_count: number; approved: number; flagged_or_pending: number; flagged_only: number;
    total_regular_hours: number; total_ot_hours: number;
  };
  payroll_trend_monthly: Array<{
    period: string; gross: number; net: number; employer_cost: number; total_outflow: number;
  }>;
  pending_actions: { leave: number; shift_swaps: number; disciplinary_active: number };
  onboarding: {
    new_joiners_90d: number;
    incomplete_count: number;
    total_template_tasks: number;
    incomplete_user_ids: string[];
  };
  compliance_30d: Array<{ id: string; due_date: string; title: string; category: string; status: string }>;
  ytd_start: string;
};

export default function HrAnalyticsPage() {
  const { data } = useFetch<Analytics>("/api/hr/analytics");
  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  const fmtRM = (n: number) =>
    `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const maxOutflow = Math.max(...data.payroll_trend_monthly.map((m) => m.total_outflow), 1);

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <HrPageHeader
        title="Analytics"
        description={`Headcount, turnover, attendance health, payroll cost trend. Year-to-date from ${data.ytd_start}.`}
      />

      {/* Top KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          icon={<Users className="h-5 w-5 text-blue-600" />}
          label="Active headcount"
          value={String(data.headcount.active)}
          sub={Object.entries(data.headcount.by_type).map(([t, n]) => `${n} ${t}`).join(" · ")}
        />
        <Kpi
          icon={<Briefcase className="h-5 w-5 text-amber-600" />}
          label="In probation"
          value={String(data.headcount.in_probation)}
          sub="auto-confirms after 3mo if no action"
        />
        <Kpi
          icon={<TrendingDown className="h-5 w-5 text-red-600" />}
          label="YTD turnover"
          value={`${data.turnover.ytd_pct}%`}
          sub={`${data.turnover.ytd_resigners} left this year`}
        />
        <Kpi
          icon={<Clock className="h-5 w-5 text-emerald-600" />}
          label="Approved attendance (90d)"
          value={`${data.attendance_90d.log_count > 0 ? Math.round((data.attendance_90d.approved / data.attendance_90d.log_count) * 100) : 0}%`}
          sub={`${data.attendance_90d.total_regular_hours}h reg + ${data.attendance_90d.total_ot_hours}h OT`}
        />
      </div>

      {/* Pending actions */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Pending Actions
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <ActionPill
            href="/hr/leave"
            label="Leave"
            count={data.pending_actions.leave}
          />
          <ActionPill
            href="/hr/shift-swaps"
            label="Shift swaps"
            count={data.pending_actions.shift_swaps}
          />
          <ActionPill
            href="/hr/employees"
            label="Active disciplinary"
            count={data.pending_actions.disciplinary_active}
          />
          <ActionPill
            href="/hr/employees"
            label="Onboarding incomplete"
            count={data.onboarding.incomplete_count}
            sub={`${data.onboarding.new_joiners_90d} joined 90d`}
          />
        </div>
      </div>

      {/* Compliance horizon */}
      <div className="rounded-xl border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="h-4 w-4 text-orange-600" />
            Compliance — next 30 days
          </h2>
          <Link href="/hr/compliance" className="text-xs text-blue-600 hover:underline">View all →</Link>
        </div>
        {data.compliance_30d.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing due in the next 30 days.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.compliance_30d.slice(0, 8).map((c) => {
              const today = new Date().toISOString().slice(0, 10);
              const overdue = c.due_date < today;
              return (
                <li key={c.id} className="flex items-center gap-3 text-xs">
                  <span className={`font-mono ${overdue ? "font-bold text-red-700" : "text-gray-500"} w-24`}>{c.due_date}</span>
                  <span className="flex-1 font-medium">{c.title}</span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] uppercase text-gray-600">{c.category.replace(/_/g, " ")}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Payroll trend */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Banknote className="h-4 w-4 text-emerald-600" />
          Payroll outflow — last {data.payroll_trend_monthly.length} months (monthly cycle)
        </h2>
        {data.payroll_trend_monthly.length === 0 ? (
          <p className="text-xs text-muted-foreground">No monthly runs yet.</p>
        ) : (
          <div className="space-y-1.5">
            {data.payroll_trend_monthly.map((m) => {
              const widthPct = (m.total_outflow / maxOutflow) * 100;
              return (
                <div key={m.period} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-gray-500">{m.period}</span>
                    <span className="font-mono font-semibold tabular-nums">{fmtRM(m.total_outflow)}</span>
                  </div>
                  <div className="mt-0.5 h-2 w-full rounded-full bg-gray-100">
                    <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${widthPct}%` }} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground">
                    <span>Net {fmtRM(m.net)}</span>
                    <span>+ Employer {fmtRM(m.employer_cost)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ActionPill({ href, label, count, sub }: { href: string; label: string; count: number; sub?: string }) {
  return (
    <Link href={href} className="rounded-lg border bg-background p-3 text-sm hover:bg-muted">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${count > 0 ? "text-red-600" : "text-gray-400"}`}>{count}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </Link>
  );
}
